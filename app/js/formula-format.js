/**
 * formula-format.js -- making a formula legible.
 *
 * The engine in formula.js keeps player formulas as text so they stay
 * auditable. Text is honest, but "floor(min(level,20)/2)+wis.mod" is not
 * *readable*, and a number with no working shown is not readable either. This
 * module is the other half of that bargain: it colours a formula, spaces it
 * out, and shows the substitution -- the same formula with each name replaced
 * by what it is worth right now -- so a player can see where a number came
 * from without holding the whole sheet in their head.
 *
 * Two rules hold everywhere in this file:
 *
 *   - Nothing here throws. A formula is highlighted while it is being typed,
 *     which means most of the time it is half-written and invalid.
 *   - Nothing here evaluates anything itself. Values come from formula.js's
 *     sandbox, exactly as they do on the sheet, so a working can never
 *     disagree with the number beside it.
 */

import {
  parse, evaluateFormula, collectReferences, resolvePath, NameIndex, FUNCTIONS,
} from './formula.js';

import { esc } from './html-escape.js';

/* ------------------------------------------------------------------ *
 * A tolerant lexer
 *
 * formula.js's tokeniser throws on the first character it does not know,
 * which is right for an evaluator and useless for a highlighter: a player
 * mid-keystroke has an unclosed bracket and half a name. This one never
 * fails -- anything it cannot classify comes back as a `bad` token, which
 * the highlighter draws in the error colour and moves on.
 * ------------------------------------------------------------------ */

const PUNCTUATION = ['<=', '>=', '==', '!=', '&&', '||', '<', '>', '=',
  '+', '-', '*', '/', '%', '^', '(', ')', ',', '?', ':'];

const BRACKETS = new Set(['(', ')', ',']);

/** Depths past this one start the bracket colours again; see --fx-nest-*. */
export const NEST_COLOURS = 3;

/**
 * Split source into display tokens: {kind, text, start}.
 * kind is one of: space number string name fn op bracket bad
 *
 * A bracket token also carries `depth`: how many pairs enclose it, counting
 * from nothing. A closer takes the depth of the opener it answers, so a pair
 * is one number and can be given one colour; a comma takes the depth of the
 * call it separates, since that is the only thing a comma is ever about. An
 * unbalanced closer -- normal, halfway through typing -- counts as 0.
 */
export function lex(source) {
  const src = String(source ?? '');
  const out = [];
  let i = 0;
  let depth = 0;
  const push = (kind, text, start) => out.push({ kind, text, start });
  const pushBracket = (text, start) => {
    if (text === '(') { out.push({ kind: 'bracket', text, start, depth }); depth += 1; return; }
    if (text === ')') { depth = Math.max(0, depth - 1); }
    out.push({ kind: 'bracket', text, start, depth: text === ',' ? Math.max(0, depth - 1) : depth });
  };

  while (i < src.length) {
    const ch = src[i];

    if (/\s/.test(ch)) {
      let j = i;
      while (j < src.length && /\s/.test(src[j])) j++;
      push('space', src.slice(i, j), i);
      i = j;
      continue;
    }

    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      push('number', src.slice(i, j), i);
      i = j;
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_.]/.test(src[j])) j++;
      const text = src.slice(i, j);
      // A name followed by "(" is a call -- the same rule the parser uses, so
      // a function is coloured as one whether or not it exists.
      let k = j;
      while (k < src.length && /\s/.test(src[k])) k++;
      push(src[k] === '(' ? 'fn' : 'name', text, i);
      i = j;
      continue;
    }

    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== ch) j++;
      // An unterminated string is still a string, visibly running to the end.
      push('string', src.slice(i, Math.min(j + 1, src.length)), i);
      i = j + 1;
      continue;
    }

    const punct = PUNCTUATION.find((p) => src.startsWith(p, i));
    if (punct) {
      if (BRACKETS.has(punct)) pushBracket(punct, i);
      else push('op', punct, i);
      i += punct.length;
      continue;
    }

    push('bad', ch, i);
    i += 1;
  }
  return out;
}

/**
 * Formula source as HTML, one span per token.
 *
 * The classes are the same wherever a formula appears -- a tracker's max, an
 * audit row, an example in the guide -- so gold always means "a name the
 * character supplies" and nothing else has to be learnt.
 */
export function highlight(source) {
  return lex(source).map((t) => (t.kind === 'space'
    ? esc(t.text)
    : `<span class="fx-${t.kind}${nestClass(t)}">${esc(t.text)}</span>`)).join('');
}

/** The colour a bracket takes for its depth, as a class; nothing for the rest. */
function nestClass(t) {
  return t.kind === 'bracket' ? ` fx-d${(t.depth || 0) % NEST_COLOURS}` : '';
}

/* ------------------------------------------------------------------ *
 * Names that only exist somewhere
 *
 * Most values belong to the character and can be read from anywhere. A few
 * belong to the *field they are written in* -- a veil's own invested essence,
 * a tracker's own numbers -- and are simply absent everywhere else, which
 * makes them the easiest thing on the sheet to get wrong. They are listed
 * here so that a formula using one somewhere it does not exist is told which
 * field it belongs to, rather than being told the name does not exist.
 * ------------------------------------------------------------------ */

export const CONTEXTUAL_VALUES = [
  {
    match: (name) => name === 'essence.self',
    names: 'essence.self',
    where: 'a veil’s own name or description',
    what: 'The essence invested in that veil. Elsewhere, use the slot name (essence.hands, essence.head) or essence.total for the pool.',
  },
  {
    match: (name) => name === 'self' || name.startsWith('self.'),
    names: 'self.max, self.current, self.remaining, self.min, self.spent, self.pct, self.zone',
    where: 'a tracker’s own note, min and zone bounds',
    what: 'That tracker’s own numbers. Elsewhere, use tracker.<id>.max. A tracker’s max cannot use self.',
  },
  {
    match: (name) => /^target(\.|$)/i.test(name),
    names: 'target, target.ranks, target.base, target.mod …',
    where: 'a forwarded bonus (the formula after += or -=)',
    what: 'The stat the bonus is added to. A formula that uses target is evaluated once per destination: in {skill -= if(target.ranks == 0, 2, 0)} it is each skill in turn. target.<part> reads that part of the destination (on Bluff, target.ranks = skill.bluff.ranks; on Will, target.base = saves.will.base). target alone is the destination’s value before bonuses are applied; for saves and armor class it leaves out the Other column. Outside a bonus, use the full name.',
  },
];

/** Why a name is missing here, when it is a name that only exists somewhere. */
export function contextualNote(name) {
  const c = CONTEXTUAL_VALUES.find((v) => v.match(String(name)));
  return c ? `${name} only exists in ${c.where}. ${c.what}` : null;
}

/** Why this token is flagged, in words a player can act on. */
function whyUnknown(kind, text) {
  if (kind === 'fn') return `there is no ${text}() function`;
  return contextualNote(text) || `"${text}" is not a value this character has`;
}

function markup(source, isUnknownName) {
  return lex(source).map((t) => {
    if (t.kind === 'space') return esc(t.text);
    const unknown = (t.kind === 'name' && isUnknownName(t.text))
      || (t.kind === 'fn' && !FUNCTIONS[t.text.toLowerCase()]);
    const title = unknown ? ` title="${esc(whyUnknown(t.kind, t.text))}"` : '';
    return `<span class="fx-${t.kind}${nestClass(t)}${unknown ? ' fx-unknown' : ''}"${title}>${esc(t.text)}</span>`;
  }).join('');
}

/**
 * Highlight, and mark every name this character cannot supply.
 *
 * For a formula being typed against the character as a whole -- the try-it
 * box -- where the character's own names are the whole of what is legal.
 */
export function highlightAgainst(source, knownNames) {
  // A plain Set is rewrapped rather than used as it stands: what is being
  // asked is "can this character supply this name", and a NameIndex is the
  // only Set that answers it the way the lookup will (see resolvePath).
  const known = knownNames instanceof NameIndex ? knownNames : new NameIndex(knownNames || []);
  return markup(source, (name) => !known.has(name));
}

/**
 * Highlight, marking exactly the names it is told to mark.
 *
 * For a formula that already lives somewhere: what is legal depends on where
 * it was written -- a veil's description may say essence.self, a tracker's
 * note may say self.max -- so the field it belongs to is the only thing that
 * can judge it. The model works that out (audit().unknownReferences) and this
 * takes the verdict, rather than second-guessing it from the character alone.
 */
export function highlightFlagging(source, unknownNames) {
  const bad = unknownNames instanceof Set ? unknownNames : new Set(unknownNames || []);
  return markup(source, (name) => bad.has(name));
}

/* ------------------------------------------------------------------ *
 * Printing an AST back out
 * ------------------------------------------------------------------ */

const PRECEDENCE = {
  '||': 1, '&&': 2,
  '==': 3, '!=': 3, '<': 3, '>': 3, '<=': 3, '>=': 3,
  '+': 4, '-': 4,
  '*': 5, '/': 5, '%': 5,
  '^': 7,
};
const RIGHT_ASSOCIATIVE = new Set(['^']);
const UNARY_PRECEDENCE = 6;

/** A number as a player would write it: no floating-point tails. */
export function formatNumber(v) {
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'string') return v;
  if (typeof v !== 'number' || !Number.isFinite(v)) return String(v ?? '');
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);
}

/** Anything that is not a plain positive number gets brackets, so a substituted
 *  −1 reads as a value and not as an operator ("2 * (-1)", never "2 * -1"). */
function bracketed(text) {
  const s = String(text);
  return /^[0-9]+(\.[0-9]+)?$/.test(s) ? s : `(${s})`;
}

/**
 * Print a parsed formula. `subst` is an optional name -> text function: when
 * it returns a string that text stands in for the name (this is what makes
 * the substitution view), and when it returns undefined the name is printed.
 *
 * Brackets are re-derived from precedence rather than copied from the source,
 * so the output is the shortest correct spelling of what the player wrote:
 * "((level))+1" comes back as "level + 1", and a bracket that is doing real
 * work is always kept.
 */
function unparse(node, minPrecedence = 0, subst = null) {
  switch (node.kind) {
    case 'number': return formatNumber(node.value);
    case 'string': return JSON.stringify(node.value);

    case 'variable': {
      const sub = subst ? subst(node.name) : undefined;
      return sub === undefined ? node.name : bracketed(sub);
    }

    case 'call':
      return `${node.name}(${node.args.map((a) => unparse(a, 0, subst)).join(', ')})`;

    case 'unary': {
      const text = `${node.op}${unparse(node.argument, UNARY_PRECEDENCE, subst)}`;
      return minPrecedence > UNARY_PRECEDENCE ? `(${text})` : text;
    }

    case 'binary': {
      const p = PRECEDENCE[node.op] ?? 0;
      const right = RIGHT_ASSOCIATIVE.has(node.op);
      // `wrote` is the operator as the player spelt it, so a formula that says
      // "= 0" is not printed back at them as "== 0".
      const text = `${unparse(node.left, right ? p + 1 : p, subst)} ${node.wrote || node.op} ${
        unparse(node.right, right ? p : p + 1, subst)}`;
      return p < minPrecedence ? `(${text})` : text;
    }

    case 'conditional': {
      const text = `${unparse(node.test, 1, subst)} ? ${
        unparse(node.consequent, 0, subst)} : ${unparse(node.alternate, 0, subst)}`;
      return minPrecedence > 0 ? `(${text})` : text;
    }

    default: return '';
  }
}

/**
 * Re-space a formula: one space around every operator, one after every comma,
 * no redundant brackets. Returns the source unchanged when it does not parse,
 * because a player who is still typing is not asking to be corrected.
 */
export function pretty(source) {
  try {
    return unparse(parse(source));
  } catch {
    return String(source ?? '').trim();
  }
}

/* ------------------------------------------------------------------ *
 * Showing the working
 * ------------------------------------------------------------------ */

/**
 * A scope object or a lookup-provider, as one lookup function.
 *
 * A provider may refuse a name outright rather than not find it -- prose's
 * `target` does, outside a bonus, to say where it belongs. Here that is a name
 * with no value like any other: the evaluation below reports the reason.
 */
function lookupFor(scope) {
  if (typeof scope?.lookup !== 'function') return (name) => resolvePath(scope, name);
  return (name) => {
    try {
      return scope.lookup(name);
    } catch {
      return undefined;
    }
  };
}

/**
 * Everything needed to explain one formula:
 *
 *   source        what the player typed
 *   pretty        the same thing, spaced out
 *   substituted   the same thing with every name replaced by its value now
 *   value         what it comes to, and `display` as text
 *   reads         [{name, value, known}] -- one entry per name it uses
 *   functions     the built-ins it calls
 *   error         why it does not work, or null
 *
 * `substituted` is the line that does the teaching: "floor(20 / 2) + 5"
 * beside "floor(level / 2) + wis.mod" answers "where did 15 come from"
 * without the player having to go and look up two values on two other tabs.
 */
export function workings(source, scope) {
  const out = {
    source: String(source ?? ''),
    pretty: '',
    substituted: '',
    value: null,
    display: '',
    reads: [],
    functions: [],
    ok: false,
    error: null,
  };

  let ast;
  try {
    ast = parse(source);
  } catch (err) {
    out.pretty = out.source.trim();
    out.substituted = out.pretty;
    out.error = err.message;
    return out;
  }

  const lookup = lookupFor(scope);
  const refs = collectReferences(ast);
  out.pretty = unparse(ast);
  out.functions = refs.functions;
  out.reads = refs.variables.map((name) => {
    const value = lookup(name);
    return { name, value: value === undefined ? null : value, known: value !== undefined };
  });
  out.substituted = unparse(ast, 0, (name) => {
    const value = lookup(name);
    return value === undefined ? undefined : formatNumber(value);
  });

  try {
    out.value = evaluateFormula(source, scope);
    out.display = formatNumber(out.value);
    out.ok = true;
  } catch (err) {
    out.error = err.message;
  }
  return out;
}

/**
 * The working as one line: "floor(level / 2) + wis.mod = floor(20 / 2) + 5 = 15".
 *
 * This is the title text on a computed value, where there is room for one line
 * and none for markup. Steps that would repeat their predecessor are dropped,
 * so a plain "12" states itself once.
 */
export function workingLine(source, scope) {
  const w = workings(source, scope);
  if (w.error) return `${w.pretty}: ${w.error}`;
  const steps = [w.pretty];
  if (w.substituted !== w.pretty) steps.push(w.substituted);
  if (w.display !== steps[steps.length - 1]) steps.push(w.display);
  return steps.join('  =  ');
}

/* ------------------------------------------------------------------ *
 * What the guide teaches
 *
 * These tables are the reference the Formulas tab renders. They live beside
 * the engine rather than in the view so the two cannot drift: the test suite
 * checks that every function in FUNCTIONS is documented here and that nothing
 * documented here has been dropped from the engine.
 * ------------------------------------------------------------------ */

/** Every built-in, grouped the way the guide shows them. */
export const FUNCTION_HELP = [
  {
    name: 'floor',
    sig: 'floor(n) · floor(n, step)',
    group: 'Rounding',
    what: 'Rounds down. Use it for half your level, a third of your ranks or anything else the rules round down. With a step, it rounds down to a multiple of the step.',
    eg: 'floor(level / 2)',
  },
  {
    name: 'ceil', sig: 'ceil(n)', group: 'Rounding',
    what: 'Rounds up.',
    eg: 'ceil(level / 4)',
  },
  {
    name: 'round', sig: 'round(n) · round(n, places)', group: 'Rounding',
    what: 'Rounds to the nearest whole number, or to that many decimal places.',
    eg: 'round(level * 1.5)',
  },
  {
    name: 'trunc', sig: 'trunc(n)', group: 'Rounding',
    what: 'Drops the fraction. The same as floor for positive numbers; negative numbers round toward zero.',
    eg: 'trunc(level / 3)',
  },
  {
    name: 'abs', sig: 'abs(n)', group: 'Rounding',
    what: 'Distance from zero: −4 becomes 4.',
    eg: 'abs(str.mod)',
  },
  {
    name: 'sign', sig: 'sign(n)', group: 'Rounding',
    what: '−1, 0 or 1, for a negative number, zero or a positive number.',
    eg: 'sign(str.mod)',
  },

  {
    name: 'min', sig: 'min(a, b, …)', group: 'Picking one',
    what: 'The smallest value. Use it for a cap: min(level, 20) never exceeds 20.',
    eg: 'min(level, 20)',
  },
  {
    name: 'max', sig: 'max(a, b, …)', group: 'Picking one',
    what: 'The largest value. Use it for a minimum: max(1, …) keeps a pool at 1 or more.',
    eg: 'max(1, wis.mod)',
  },
  {
    name: 'clamp', sig: 'clamp(n, low, high)', group: 'Picking one',
    what: 'A number cannot fall below the lower number or go above the higher number.',
    eg: 'clamp(level - 4, 0, 10)',
  },
  {
    name: 'sum', sig: 'sum(a, b, …)', group: 'Picking one',
    what: 'Adds all the values. The same as writing + between them, but easier to read in a long list.',
    eg: 'sum(str.mod, dex.mod, con.mod)',
  },

  {
    name: 'if', sig: 'if(test, then, otherwise)', group: 'Choosing',
    what: 'Evaluates a condition. If the condition is true, the first result is used, otherwise the second result.',
    eg: 'if(mythic.tier = 0, 0, 3 + mythic.tier * 2)',
  },
  {
    name: 'and', sig: 'and(a, b, …)', group: 'Choosing',
    what: 'True when every one of them is true.',
    eg: 'and(level >= 5, mythic.tier >= 1)',
  },
  {
    name: 'or', sig: 'or(a, b, …)', group: 'Choosing',
    what: 'True when any one of them is true.',
    eg: 'or(level >= 20, mythic.tier >= 8)',
  },
  {
    name: 'not', sig: 'not(a)', group: 'Choosing',
    what: 'Turns true into false and false into true.',
    eg: 'not(level >= 5)',
  },

  {
    name: 'mod', sig: 'mod(score)', group: 'Pathfinder',
    what: 'The ability modifier rule: (score − 10) ÷ 2, rounded down. Every ability already has its modifier as str.mod and so on; use this for a score the sheet does not track.',
    eg: 'mod(18)',
  },
  {
    name: 'iterations', sig: 'iterations(bab)', group: 'Pathfinder',
    what: 'Attacks based on the character’s base attack bonus: one, plus one additional attack at +6, +11 and +16 each.',
    eg: 'iterations(bab)',
  },
  {
    name: 'dice', sig: 'dice(count, size) · dice(count, size, bonus)', group: 'Pathfinder',
    what: 'Builds dice text instead of a number, for a weapon’s Dice field or a name a weapon reads. dice(4, 8) is 4d8.',
    eg: 'dice(floor(level / 4) + 1, 6)',
  },
  {
    name: 'step', sig: 'step("die", steps)', group: 'Pathfinder',
    what: 'Moves a die along the damage chain (1, 1d2, 1d3, 1d4, 1d6, 1d8, 1d10, 2d6, 2d8, 3d6, 2d10, 4d6 … 16d6), as in "one die size per five levels". step("1d6", 2) is 1d6 -> 1d8 -> 1d10. The chain stops at its ends, and a die not on the chain is an error.',
    eg: 'step("1", floor(level / 5))',
  },
  {
    name: 'tags', sig: 'tags("name")', group: 'Pathfinder',
    what: 'Counts the feats, granted feats and bought-off drawbacks with a tag in square brackets: tags("Chance") counts every [Chance]. [Chance, Deck] counts once for each tag. A tag no feat has is 0, while tags.chance would be an unknown value.',
    eg: 'tags("Chance") + tags("Deck")',
  },
];

/** Operators, loosest-binding first, which is roughly the order they read in. */
export const OPERATOR_HELP = [
  { op: '+  -  *  /', what: 'Add, subtract, multiply, divide.', eg: '10 + con.mod * 2' },
  { op: '%', what: 'The remainder after dividing. level % 4 is 0 on every fourth level.', eg: 'level % 4' },
  { op: '^', what: 'To the power of.', eg: '2 ^ 3' },
  { op: '( )', what: 'Elements of the formula within parentheses are evaluated before others. See PEMDAS for further information.', eg: '(level + 4) / 2' },
  { op: '<  >  <=  >=', what: 'Comparisons. They evaluate to true or false, or 1 or 0 when used arithmetically.', eg: 'level >= 11' },
  { op: '=  !=', what: 'Equal and not equal. A single = is a comparison, never an assignment.', eg: 'mythic.tier = 0' },
  { op: '&&  ||', what: 'And, or. and(…) and or(…) do the same.', eg: 'level >= 5 && con.mod > 0' },
  { op: '? :', what: 'Short form of if(): "test ? this : that".', eg: 'level >= 11 ? 2 : 1' },
];

/**
 * The families of values a character publishes. The Formulas tab lists the
 * real names live; these say what the families *mean*, which a list of four
 * hundred names does not.
 */
export const VALUE_GUIDE = [
  { prefix: 'level, bab, initiative', what: 'The plain numbers: character level, base attack bonus, initiative.', eg: 'floor(level / 2)' },
  { prefix: 'str.score, str.mod, str.temp, str.tempMod', what: 'Each ability four ways: score, modifier, temporary score and temporary modifier. dex, con, int, wis and cha work the same way.', eg: '10 + con.mod' },
  { prefix: 'hp.total, hp.current, ac.total, ac.touch, ac.flatFooted, ac.cmd', what: 'The sheet’s totals for hit points, armor class and CMD.', eg: 'floor(hp.total / 4)' },
  { prefix: 'saves.fortitude, saves.reflex, saves.will', what: 'The three saving throw totals.', eg: 'saves.will + 2' },
  { prefix: 'ac.armor, ac.shield, ac.ability', what: 'The armor bonus, the combined bonus of every active shield, and the ability bonus after the armor’s Max Dex.', eg: 'ac.shield * 2' },
  { prefix: 'ac.armor.type, ac.armor.heavy, ac.maxDex, ac.acp', what: 'More about the armor worn: its weight class (0 none, 1 light, 2 medium, 3 heavy; ac.armor.light / medium / heavy are 1 or 0), its enhancement (ac.armor.enhancement, ac.shield.enhancement), the lowest Max Dex worn (99 when nothing caps it) and the armor check penalty.', eg: 'if(ac.armor.type >= 2, 2, 0)' },
  { prefix: 'ac.shield1, ac.shield2 …', what: 'One value per shield row, numbered from 1 in the order the Equipment tab lists them. A shield you are not holding reads 0, so they always add up to ac.shield.', eg: 'ac.shield1' },
  { prefix: 'ac.dodge, ac.natural, ac.deflection, ac.insight …', what: 'Each typed column of the AC row on the Stats tab, by column name: dodge, natural, enhancement, deflection, circumstance, insight, luck, morale, sacred, profane, untyped, size, template and the ABP pair.', eg: 'if(ac.dodge > 0, 2, 0)' },
  { prefix: 'saves.will.base, saves.will.ability, saves.will.luck …', what: 'Each save’s base, ability modifier and typed columns by name (resistance, morale, trait, racial and the rest). saves.will and saves.will.total are the same total.', eg: 'saves.fortitude.resistance' },
  { prefix: 'attack.melee, attack.ranged, attack.cmb', what: 'The attack numbers.', eg: 'attack.cmb + 4' },
  { prefix: 'skill.<name>', what: 'Any skill total, by its name in lower case with underscores for spaces.', eg: 'skill.perception + 5' },
  { prefix: 'skill.<name>.ranks, skill.<name>.classSkill', what: 'Ranks in the skill, and 1 or 0 for class skill. skill.<name> alone is the total.', eg: 'if(skill.stealth.ranks >= 10, 6, 3)' },
  { prefix: 'speed.<type>', what: 'Each movement rate by type in lower case (speed.land, speed.fly, speed.climb), as the Speed panel totals it before conditions. A speed can read the speeds listed above it, not below.', eg: 'floor(speed.land / 2)' },
  { prefix: 'tags.<tag>', what: 'The number of feats, granted feats and bought-off drawbacks with each tag in square brackets: tags.chance for [Chance]. Only tags in use are listed; tags("chance") gives the same count, and 0 for an unused tag.', eg: 'tags.deck * 2' },
  { prefix: 'mythic.tier', what: 'Mythic tier, or 0 for a non-mythic character.', eg: 'if(mythic.tier = 0, 0, 3 + mythic.tier * 2)' },
  { prefix: 'tracker.<id>.max .current .remaining .min .spent .pct', what: 'Each tracker’s numbers, under the id shown on its row. The id does not change when the tracker is renamed, so formulas that use it keep working.', eg: 'tracker.burn.max - 2' },
  { prefix: 'familiar.*  animalCompanion.*  eidolon.*  conjured.*', what: 'A companion’s numbers, under the id shown on its tab. The first of a kind uses the kind’s name; later ones add a number (eidolon2, eidolon3). The id stays the same when the companion is renamed or reordered.', eg: 'eidolon.hd + eidolon2.hd' },
  { prefix: 'sphere.<name>.dc .ranks .close .medium .long', what: 'Each skill sphere by name: sphere.body_control.dc, sphere.study.ranks. Skill spheres have no caster level; their numbers come from the ranks in each sphere’s associated skill. operative.mod, operative.leverage and operative.plans belong to the character, not to a sphere.', eg: 'sphere.bluster.close' },
  { prefix: 'spheres.cl .dc .msb .msd', what: 'The magic sphere casting numbers: caster level, global DC, magic skill bonus and magic skill defense. These are the same values as caster.level, caster.dc, caster.msb and caster.msd, under the names used to add a bonus to them.', eg: 'floor(spheres.cl / 2)' },
  { prefix: 'vancian.<class>.cl, vancian.cl', what: 'Each Vancian casting class’s caster level, by the block’s name, and vancian.cl for the highest of them.', eg: 'vancian.wizard.cl' },
  { prefix: 'manifester.<class>.level, manifester.level', what: 'Each manifesting class’s manifester level, and manifester.level for the highest.', eg: 'manifester.psion.level' },
  { prefix: 'anything you named yourself', what: 'Every {name = …} you have written in text anywhere on the character. They are listed and read the same way as built-in values.', eg: 'qi.max' },
  { prefix: 'StrMod, Fort, MythicTier, VeilEssenceHands …', what: 'The workbook’s named ranges, so a formula pasted from a spreadsheet still works. Each one is another name for a value above; StrMod is str.tempMod, the working modifier. Only names checked against the source workbooks are included.', eg: 'floor(StrMod / 2)' },
];

/** Where formulas may be written — the other half of "how do I use this". */
export const PLACES_GUIDE = [
  {
    where: 'Prose, inside braces',
    what: 'Any text field, such as class features, notes, traits, weapon properties and cards.',
    eg: 'Hardness {arms.hardness = con.mod}, HP {arms.hp = 3 * con.mod}.',
  },
  {
    where: 'A tracker’s max and min',
    what: 'On the Trackers tab. The result sets how many pips you can spend.',
    eg: '3 + mythic.tier * 2',
  },
  {
    where: 'A tracker’s zone bounds',
    what: 'In a tracker’s ✎ editor: a warning range that changes with the character instead of a fixed number.',
    eg: 'self.max - 2',
  },
  {
    where: 'Single-value fields',
    what: 'Skill ranks, crafting amounts, a weapon’s dice, a speed bonus and other fields where the whole value can be a formula.',
    eg: 'level * 100',
  },
];

/** The four token forms: the first thing to learn, and the only syntax to memorise. */
export const TOKEN_FORMS = [
  {
    form: '{= expr}',
    name: 'Show a value',
    what: 'Calculates the value and shows it where you wrote it. Nothing else on the sheet can read it.',
    eg: 'A blast does {= floor(level / 2)}d6.',
  },
  {
    form: '{name = expr}',
    name: 'Name a value',
    what: 'Calculates the value, shows it and gives it a name that trackers, weapons and other formulas can read. This is how you make your own variable.',
    eg: 'Qi pool {qi.max = wis.mod + level}.',
  },
  {
    form: '{name}',
    name: 'Reuse a value',
    what: 'Shows a value you named elsewhere.',
    eg: 'Spend {qi.max} qi at dawn.',
  },
  {
    form: '{dest += expr}',
    name: 'Forward a bonus',
    what: 'Calculates the value, shows it and adds it to another stat: a skill, a save, AC, '
      + 'an attack, an ability score, a class level, a tracker’s maximum, or damage on some or '
      + 'all weapons. The rule stays in the feature that grants it. Separate several '
      + 'destinations with commas; use -= for a penalty. End with "as size" (or morale, luck, …) '
      + 'so it does not stack with another bonus of that type, or "as temp.size" to make it '
      + 'temporary. "target.skill.bluff = …" is the long form. Inside the formula, target is the '
      + 'stat being added to (target.ranks on a skill, target.base on a save), and the formula '
      + 'is evaluated once per destination.',
    eg: 'Mythic Social Grace {skill.bluff, skill.diplomacy += mythic.tier}.',
  },
];

export const __testing = { unparse, bracketed };
