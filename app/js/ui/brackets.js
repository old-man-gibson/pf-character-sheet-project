/**
 * ui/brackets.js -- the other end of the bracket you are standing next to.
 *
 * `floor(min(level, 20) / 2) + max(0, wis.mod)` is four brackets and two of
 * them close in the same place. Reading that in a five-rem input means
 * counting on your fingers, and the sheet already knows how to count: put the
 * caret beside a bracket and this lights it and its partner, so the shape of
 * the formula is something you look at rather than something you work out.
 *
 * A native input cannot colour part of its own text, so the highlight is drawn
 * on a **mirror**: a div behind the field holding the same text in the same
 * metrics, invisible except for the two marks. The field keeps its own text,
 * caret and selection -- nothing here touches what is typed, and a browser
 * that never runs it loses a hint and nothing else.
 *
 * The scanning half is pure and lives at the top, because it is what the tests
 * can reach; the DOM half is the last twenty lines.
 */
import { esc } from './html.js';

/** Which closer answers which opener. Braces count: prose writes {…} tokens. */
const OPENERS = { '(': ')', '[': ']', '{': '}' };
const CLOSERS = { ')': '(', ']': '[', '}': '{' };

/** How many depths get a colour of their own before the cycle repeats. */
export const NEST_COLOURS = 3;

/**
 * Every bracket in the text: where it is, how deep, and where its partner is.
 *
 * Quoted spans are skipped, because a bracket inside a string is a character
 * and not a nest -- `if(name = "a)b", 1, 0)` closes once, not twice.
 *
 * A closer answers only the nearest opener of its own kind. Anything else --
 * a stray `)`, a `(` closed by `]` -- is left with no partner rather than
 * guessed at, since a formula being typed is unbalanced most of the time and
 * a wrong guess is worse than no answer.
 *
 * @returns {Array<{at:number, ch:string, open:boolean, depth:number, partner:number}>}
 *   `partner` indexes back into this list, or -1 where there is none.
 */
export function scanBrackets(text) {
  const src = String(text ?? '');
  const out = [];
  const open = [];
  let quote = null;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (OPENERS[ch]) {
      open.push(out.length);
      out.push({ at: i, ch, open: true, depth: open.length - 1, partner: -1 });
      continue;
    }
    if (CLOSERS[ch]) {
      const top = open.length ? out[open[open.length - 1]] : null;
      if (top && top.ch === CLOSERS[ch]) {
        open.pop();
        out.push({ at: i, ch, open: false, depth: top.depth, partner: out.indexOf(top) });
        top.partner = out.length - 1;
      } else {
        out.push({ at: i, ch, open: false, depth: 0, partner: -1 });
      }
    }
  }
  return out;
}

/**
 * The bracket the caret is beside, and the one that answers it.
 *
 * The character *before* the caret wins over the one after it, which is the
 * rule every editor uses and the one typing wants: finish `…20)` and the
 * opener it just closed lights up.
 *
 * @returns {{at:number, partner:number, depth:number, matched:boolean}|null}
 */
export function pairAtCaret(text, caret) {
  const at = Number(caret);
  if (!Number.isFinite(at) || at < 0) return null;
  const marks = scanBrackets(text);
  const mark = marks.find((m) => m.at === at - 1) || marks.find((m) => m.at === at);
  if (!mark) return null;
  const partner = mark.partner >= 0 ? marks[mark.partner] : null;
  return {
    at: mark.at,
    partner: partner ? partner.at : -1,
    depth: mark.depth,
    matched: !!partner,
  };
}

/**
 * The text as the mirror draws it: nothing showing but the pair.
 *
 * The whole text is written out, invisibly, because the marks are placed by
 * the text in front of them -- take a character away and every highlight after
 * it slides. An unmatched bracket is marked too, in the error colour: "there
 * is no other end" is worth as much as knowing where it is.
 */
export function mirrorHtml(text, pair) {
  const src = String(text ?? '');
  if (!pair) return esc(src);
  const spots = [pair.at, pair.partner].filter((n) => n >= 0).sort((a, b) => a - b);
  const cls = pair.matched ? `bx-hit bx-d${pair.depth % NEST_COLOURS}` : 'bx-hit bx-miss';
  let out = '';
  let from = 0;
  for (const at of spots) {
    out += `${esc(src.slice(from, at))}<mark class="${cls}">${esc(src[at])}</mark>`;
    from = at + 1;
  }
  // A trailing newline leaves the mirror a line shorter than the textarea,
  // which only matters if the caret ever sits past it -- but it costs one
  // character to be exact.
  return `${out}${esc(src.slice(from))}${src.endsWith('\n') ? ' ' : ''}`;
}

/* ------------------------------------------------------------------ *
 * The mirror
 * ------------------------------------------------------------------ */

/** Fields that understand formulas, and so are worth matching brackets in. */
export function isFormulaField(el) {
  if (!el || el.disabled || el.readOnly) return false;
  const tag = el.tagName;
  if (tag !== 'TEXTAREA' && !(tag === 'INPUT' && el.type === 'text')) return false;
  return !!el.closest('.prose, .xf') || (el.classList.contains('mono') && !el.classList.contains('hexin'));
}

/**
 * Everything that decides where a glyph lands. Copied off the field rather
 * than written in the stylesheet because the same prose field is 0.85rem in a
 * panel, 0.78rem in a template table and 0.76rem on a veil card: a mirror
 * built from CSS would line up in one of those three.
 */
const METRICS = [
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant', 'letterSpacing',
  'lineHeight', 'textIndent', 'textTransform', 'wordSpacing', 'textAlign', 'direction',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderRadius', 'backgroundColor',
];

/** Take the mirror away, and the field back to its own background. */
export function hideBrackets(field) {
  field?.classList?.remove('bx-lit');
  field?.parentElement?.querySelector(':scope > .bx-mirror')?.remove();
}

/**
 * Draw (or redraw) the mirror for a field, or take it away if the caret is
 * not beside a bracket.
 *
 * The mirror is a sibling, so it and the field measure from the same corner:
 * `offsetLeft` is relative to the nearest positioned ancestor, and an
 * absolutely positioned sibling resolves against exactly that. No wrapper is
 * needed and no markup changes, which is why a formula field anywhere on the
 * sheet gets this without knowing about it.
 */
export function showBrackets(field) {
  if (!isFormulaField(field)) return;
  const host = field.parentElement;
  const caret = field.selectionStart === field.selectionEnd ? field.selectionStart : -1;
  const pair = host && caret >= 0 ? pairAtCaret(field.value, caret) : null;
  if (!pair) { hideBrackets(field); return; }

  let mirror = host.querySelector(':scope > .bx-mirror');
  if (!mirror) {
    mirror = document.createElement('div');
    mirror.className = 'bx-mirror';
    mirror.setAttribute('aria-hidden', 'true');
    host.insertBefore(mirror, field);
  }
  // Measured with the field back in its own skin: `bx-lit` takes its
  // background away so the marks can show through, and a redraw that read the
  // field as it currently stands would copy that transparency onto the mirror
  // and leave the pair floating on the panel.
  field.classList.remove('bx-lit');
  const cs = getComputedStyle(field);
  for (const p of METRICS) mirror.style[p] = cs[p];
  // Width comes off the rect rather than offsetWidth, which is rounded: a
  // mirror a rounded pixel narrower than the textarea wraps a long line one
  // word earlier, and every mark after that point is a line out.
  const rect = field.getBoundingClientRect();
  mirror.style.left = `${field.offsetLeft}px`;
  mirror.style.top = `${field.offsetTop}px`;
  mirror.style.width = `${rect.width}px`;
  mirror.style.height = `${rect.height}px`;
  mirror.style.whiteSpace = field.tagName === 'TEXTAREA' ? 'pre-wrap' : 'pre';
  mirror.innerHTML = mirrorHtml(field.value, pair);
  mirror.scrollTop = field.scrollTop;
  mirror.scrollLeft = field.scrollLeft;
  field.classList.add('bx-lit');
}
