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

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

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
    what: 'the essence invested in that veil. Elsewhere, name the slot instead — essence.hands, essence.head — or read essence.total for the pool.',
  },
  {
    match: (name) => name === 'self' || name.startsWith('self.'),
    names: 'self.max, self.current, self.remaining, self.min, self.spent, self.pct, self.zone',
    where: 'a tracker’s own note, min and zone bounds',
    what: 'that tracker, without naming itself. Elsewhere, name it — tracker.<id>.max — and note that a tracker’s max cannot use self at all, since that would be defining itself.',
  },
];

/** Why a name is missing here, when it is a name that only exists somewhere. */
export function contextualNote(name) {
  const c = CONTEXTUAL_VALUES.find((v) => v.match(String(name)));
  return c ? `${name} only exists in ${c.where} — ${c.what}` : null;
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

/** A scope object or a lookup-provider, as one lookup function. */
function lookupFor(scope) {
  return typeof scope?.lookup === 'function'
    ? (name) => scope.lookup(name)
    : (name) => resolvePath(scope, name);
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
  if (w.error) return `${w.pretty} — ${w.error}`;
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
    what: 'Rounds down. The workhorse — half your level, a third of your ranks, anything the rules say to round down. Given a step it rounds down to a multiple of it.',
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
    what: 'Throws the fraction away. The same as floor for positive numbers; a negative one rounds towards zero instead of down.',
    eg: 'trunc(level / 3)',
  },
  {
    name: 'abs', sig: 'abs(n)', group: 'Rounding',
    what: 'Distance from zero: −4 becomes 4.',
    eg: 'abs(str.mod)',
  },
  {
    name: 'sign', sig: 'sign(n)', group: 'Rounding',
    what: '−1, 0 or 1, depending on which side of zero the number falls.',
    eg: 'sign(str.mod)',
  },

  {
    name: 'min', sig: 'min(a, b, …)', group: 'Picking one',
    what: 'The smallest of what it is given, which is how you write a cap: min(level, 20) never exceeds 20.',
    eg: 'min(level, 20)',
  },
  {
    name: 'max', sig: 'max(a, b, …)', group: 'Picking one',
    what: 'The largest, which is how you write a floor: max(1, …) keeps a pool from dropping below one.',
    eg: 'max(1, wis.mod)',
  },
  {
    name: 'clamp', sig: 'clamp(n, low, high)', group: 'Picking one',
    what: 'Holds a number inside a range, both ends at once.',
    eg: 'clamp(level - 4, 0, 10)',
  },
  {
    name: 'sum', sig: 'sum(a, b, …)', group: 'Picking one',
    what: 'Adds everything up. Never shorter than writing + between them, but it reads better down a long list.',
    eg: 'sum(str.mod, dex.mod, con.mod)',
  },

  {
    name: 'if', sig: 'if(test, then, otherwise)', group: 'Choosing',
    what: 'Picks between two answers. The branch not taken is never worked out, so it is safe to divide by something in one of them.',
    eg: 'if(mythic.tier = 0, 0, 3 + mythic.tier * 2)',
  },
  {
    name: 'and', sig: 'and(a, b, …)', group: 'Choosing',
    what: 'True when every one of them is true.',
    eg: 'and(level >= 5, mythic.tier >= 1)',
  },
  {
    name: 'or', sig: 'or(a, b, …)', group: 'Choosing',
    what: 'True when any one of them is.',
    eg: 'or(level >= 20, mythic.tier >= 8)',
  },
  {
    name: 'not', sig: 'not(a)', group: 'Choosing',
    what: 'Turns true into false and back.',
    eg: 'not(level >= 5)',
  },

  {
    name: 'mod', sig: 'mod(score)', group: 'Pathfinder',
    what: 'The ability-modifier rule, (score − 10) ÷ 2 rounded down. You rarely need it, because every ability already publishes its modifier as str.mod and the rest — it is here for a score the sheet does not hold.',
    eg: 'mod(18)',
  },
  {
    name: 'iterations', sig: 'iterations(bab)', group: 'Pathfinder',
    what: 'How many attacks a base attack bonus buys: one, and another for every five points.',
    eg: 'iterations(bab)',
  },
  {
    name: 'dice', sig: 'dice(count, size) · dice(count, size, bonus)', group: 'Pathfinder',
    what: 'Builds dice text instead of a number, for a weapon’s Dice field or a name a weapon reads. dice(4, 8) is 4d8.',
    eg: 'dice(floor(level / 4) + 1, 6)',
  },
];

/** Operators, loosest-binding first, which is roughly the order they read in. */
export const OPERATOR_HELP = [
  { op: '+  -  *  /', what: 'Add, subtract, multiply, divide.', eg: '10 + con.mod * 2' },
  { op: '%', what: 'The remainder after dividing. level % 4 is 0 on every fourth level.', eg: 'level % 4' },
  { op: '^', what: 'To the power of.', eg: '2 ^ 3' },
  { op: '( )', what: 'Do this part first. × and ÷ already happen before + and −, so brackets are for when you want a different order.', eg: '(level + 4) / 2' },
  { op: '<  >  <=  >=', what: 'Comparisons. They come out as yes or no, and count as 1 or 0 when you add them.', eg: 'level >= 11' },
  { op: '=  !=', what: 'Equal and not equal. A single = is read as a comparison here, never as an assignment, because everyone types it that way out of spreadsheet habit.', eg: 'mythic.tier = 0' },
  { op: '&&  ||', what: 'Both, and either. and(…) and or(…) do the same job in words.', eg: 'level >= 5 && con.mod > 0' },
  { op: '? :', what: 'The short spelling of if(): "test ? this : that".', eg: 'level >= 11 ? 2 : 1' },
];

/**
 * The families of values a character publishes. The Formulas tab lists the
 * real names live; these say what the families *mean*, which a list of four
 * hundred names does not.
 */
export const VALUE_GUIDE = [
  { prefix: 'level, bab, initiative', what: 'The plain numbers: character level, base attack bonus, initiative.', eg: 'floor(level / 2)' },
  { prefix: 'str.score, str.mod, str.temp, str.tempMod', what: 'Each ability four ways: the score, its modifier, the temporary score and its modifier. dex, con, int, wis and cha are the same.', eg: '10 + con.mod' },
  { prefix: 'hp.total, hp.current, ac.total, ac.touch, ac.flatFooted, ac.cmd', what: 'What the sheet worked out for hit points, armour class and CMD.', eg: 'floor(hp.total / 4)' },
  { prefix: 'saves.fortitude, saves.reflex, saves.will', what: 'The three saving throws, as the sheet totals them.', eg: 'saves.will + 2' },
  { prefix: 'ac.armor, ac.shield, ac.ability', what: 'What the armour class is wearing: the armour’s own bonus, every active shield’s together, and the ability bonus after the armour has capped it.', eg: 'ac.shield * 2' },
  { prefix: 'ac.shield1, ac.shield2 …', what: 'Where you keep several of a thing, each one takes the family name and a number from one — one per shield row, in the order the Equipment tab lists them. A row you are not holding reads 0, so the numbers always add up to ac.shield.', eg: 'ac.shield1' },
  { prefix: 'ac.dodge, ac.natural, ac.deflection, ac.insight …', what: 'Every typed column of the Stats tab’s AC row, under the name on the column. One for each: dodge, natural, enhancement, deflection, circumstance, insight, luck, morale, sacred, profane, untyped, size, template and the ABP pair.', eg: 'if(ac.dodge > 0, 2, 0)' },
  { prefix: 'saves.will.base, saves.will.ability, saves.will.luck …', what: 'The same for each save: its base save, its ability modifier, and every typed column by name — resistance, morale, trait, racial and the rest. The save’s own name still reads the total, so saves.will and saves.will.total are one number.', eg: 'saves.fortitude.resistance' },
  { prefix: 'attack.melee, attack.ranged, attack.cmb', what: 'The attack numbers.', eg: 'attack.cmb + 4' },
  { prefix: 'skill.<name>', what: 'Any skill total, by its name in lower case with underscores for spaces.', eg: 'skill.perception + 5' },
  { prefix: 'speed.<type>', what: 'Each movement rate by its type in lower case — speed.land, speed.fly, speed.climb — as the Speed panel totals it, before conditions. A speed may read the speeds listed above it and not the ones below.', eg: 'floor(speed.land / 2)' },
  { prefix: 'mythic.tier', what: 'Mythic tier, and 0 for a character who has none.', eg: 'if(mythic.tier = 0, 0, 3 + mythic.tier * 2)' },
  { prefix: 'tracker.<id>.max .current .remaining .min .spent .pct', what: 'Every tracker publishes its numbers under the id shown on its own row. That id never changes when the tracker is renamed, so a formula pointing at one cannot be broken by renaming it.', eg: 'tracker.burn.max - 2' },
  { prefix: 'familiar.*  animalCompanion.*  eidolon.*  conjured.*', what: 'A companion’s own numbers, on a character that has one — the first of each kind.', eg: 'eidolon.hd + 2' },
  { prefix: 'companion.<id>.*', what: 'Any companion by the id on its chip, when a character keeps several.', eg: 'companion.eidolon2.hp' },
  { prefix: 'sphere.<name>.dc .ranks .close .medium .long', what: 'Each skill sphere under its own name — sphere.body_control.dc, sphere.study.ranks. A guile sphere has no caster level to read: every number it produces comes off the ranks in its associated skill, and they differ sphere by sphere, which is why each gets a name of its own. operative.mod, operative.leverage and operative.plans are the ones that belong to the character rather than to a sphere.', eg: 'sphere.bluster.close' },
  { prefix: 'anything you named yourself', what: 'Every {name = …} you have written in prose, anywhere on the character. They sit in the same list as the built-in values and are read the same way — they are the point of the whole system.', eg: 'qi.max' },
  { prefix: 'StrMod, Fort, MythicTier, VeilEssenceHands …', what: 'The workbook’s own named ranges, so a formula pasted out of a spreadsheet keeps working. Each is another name for a value above — StrMod is str.tempMod, the working modifier, which is the one the workbook meant. Only names that were checked against the source sheets are here; the rest were configuration cells and have no number to point at.', eg: 'floor(StrMod / 2)' },
];

/** Where formulas may be written — the other half of "how do I use this". */
export const PLACES_GUIDE = [
  {
    where: 'Prose, inside braces',
    what: 'Class features, template features, notes, background, traits, mythic abilities, weapon properties, gear notes, veils, cards, crafting notes — anywhere you can type a paragraph.',
    eg: 'Hardness {arms.hardness = con.mod}, HP {arms.hp = 3 * con.mod}.',
  },
  {
    where: 'A tracker’s max and min',
    what: 'On the Trackers tab. This is where a formula becomes a row of pips you can actually spend.',
    eg: '3 + mythic.tier * 2',
  },
  {
    where: 'A tracker’s zone bounds',
    what: 'In a tracker’s ✎ editor: a danger band that moves with the character instead of sitting at a fixed number.',
    eg: 'self.max - 2',
  },
  {
    where: 'Single-value fields',
    what: 'Skill ranks bought, crafting amounts, a weapon’s dice, a speed bonus — anywhere the whole value may be an expression instead of a number.',
    eg: 'level * 100',
  },
];

/** The four token forms: the first thing to learn, and the only syntax to memorise. */
export const TOKEN_FORMS = [
  {
    form: '{= expr}',
    name: 'Show a value',
    what: 'Works it out and prints it where you wrote it. Nothing else on the sheet can see it.',
    eg: 'A blast does {= floor(level / 2)}d6.',
  },
  {
    form: '{name = expr}',
    name: 'Name a value',
    what: 'The same, and gives the answer a name the whole character can read — trackers, weapons, other formulas, anywhere. This is how you make your own variable.',
    eg: 'Qi pool {qi.max = wis.mod + level}.',
  },
  {
    form: '{name}',
    name: 'Reuse a value',
    what: 'Prints a name you defined elsewhere. Define it once, quote it everywhere.',
    eg: 'Spend {qi.max} qi at dawn.',
  },
  {
    form: '{dest += expr}',
    name: 'Forward a bonus',
    what: 'Works it out, prints it, and adds it to something else — a skill, a save, AC, '
      + 'an attack, an ability score, a class level, a tracker’s maximum, damage on some or '
      + 'all of your weapons. '
      + 'The rule lives in '
      + 'the feature that grants it instead of '
      + 'being copied into every column it touches. Several destinations at once, separated by '
      + 'commas; -= for a penalty; end with "as size" (or morale, luck, …) and it will not '
      + 'stack with another bonus of that type, or "as temp.size" to make it a temporary '
      + 'one. "target.bluff = …" says the same thing the long way.',
    eg: 'Mythic Social Grace {skill.bluff, skill.diplomacy += mythic.tier}.',
  },
];

export const __testing = { unparse, bracketed };
