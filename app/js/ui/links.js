/**
 * ui/links.js -- web addresses in what a player wrote, drawn as links.
 *
 * Two shapes, one reading of what an address is:
 *
 *  - In prose (a note, a feat's effect), every address in the text is a link
 *    in the field's read view and the words around it are escaped as ever.
 *    `[words](address)`, as Markdown writes it, links the words instead and
 *    hides the address. See `prose()` in ui/prose.js; the box it edits in is
 *    unchanged.
 *  - A field that holds one address (an approval's Link, a template's link)
 *    stays a text box, with an ↗ beside it that opens the address
 *    (`linkField` in ui/fields.js).
 *
 * Only http: and https: are links. Anything else typed there (javascript:,
 * data:, file:) stays text: a published sheet is opened by people who did not
 * write it, and a link is the one part of a note that does something when it
 * is clicked. Imports nothing but the escaper, so any module can use it.
 */
import { esc } from '../html-escape.js';

/*
 * From the scheme to the first space, double quote, angle bracket, backtick
 * or brace. None of those can stand unescaped in an address, and a brace is
 * where a {…} formula starts. An apostrophe can (a spell's name in a query
 * string), so it ends one only as the last character. `\b` keeps "xhttp://"
 * from matching inside a word.
 */
const URL_RE = /\bhttps?:\/\/[^\s<>"`{}]+/gi;

/** Punctuation that ends the sentence rather than the address: "see https://a.example." */
const TRAILING = new Set(['.', ',', ':', ';', '!', '?', "'", '’', '”', '…']);

/** A closing bracket, and the one that opens it. */
const OPENER = { ')': '(', ']': '[' };

const count = (s, c) => s.split(c).length - 1;

/**
 * An address with the sentence's punctuation taken off its end: a full stop,
 * a comma, and a closing bracket with no opening one in the address -- the
 * one around "(see https://a.example)". A bracket the address opened itself
 * stays: https://wiki.example/Fire_(element) ends with one.
 */
function trimEnd(url) {
  let s = url;
  for (;;) {
    const last = s[s.length - 1];
    if (TRAILING.has(last)) { s = s.slice(0, -1); continue; }
    const open = OPENER[last];
    if (open && count(s, last) > count(s, open)) { s = s.slice(0, -1); continue; }
    return s;
  }
}

/** Every address in the text: where it starts, and the address itself. */
export function findUrls(text) {
  const src = String(text ?? '');
  if (!/https?:\/\//i.test(src)) return [];
  const out = [];
  for (const m of src.matchAll(URL_RE)) {
    const url = trimEnd(m[0]);
    // "https://" and nothing after it is not an address.
    if (/^https?:\/\/./i.test(url)) out.push({ at: m.index, url });
  }
  return out;
}

/*
 * The start of words linked to an address: "[the map](". The words are on
 * one line and hold no bracket or brace. A brace is where a {…} formula
 * starts, and a formula is worked out in a piece of the text of its own, so
 * a link's words are shown as typed.
 */
const WORDS_RE = /\[([^[\]{}\n]+)\]\(/g;

/**
 * The address in round brackets from `from` to the bracket that closes it,
 * or null. A pair of brackets inside it is part of it:
 * [Fire](https://wiki.example/Fire_(element)). It holds what an address
 * typed on its own may hold, so a space or a quote means it is not one.
 */
function bracketedUrl(src, from) {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (/[\s<>"`{}]/.test(c)) return null;
    if (c === '(') depth++;
    else if (c === ')') {
      if (depth) { depth--; continue; }
      const url = src.slice(from, i);
      return /^https?:\/\/./i.test(url) ? { url, end: i + 1 } : null;
    }
  }
  return null;
}

/**
 * Every link in the text, in order: words linked with `[words](address)`,
 * and each address typed on its own. `at` and `end` are where its source
 * starts and ends in the text; `words` is null for an address shown as typed.
 */
export function findLinks(text) {
  const src = String(text ?? '');
  if (!/https?:\/\//i.test(src)) return [];
  const out = [];
  let last = 0;
  const bare = (upTo) => {
    for (const { at, url } of findUrls(src.slice(last, upTo))) {
      out.push({ at: last + at, end: last + at + url.length, url, words: null });
    }
  };
  for (const m of src.matchAll(WORDS_RE)) {
    if (m.index < last || !m[1].trim()) continue;
    const link = bracketedUrl(src, m.index + m[0].length);
    if (!link) continue;
    bare(m.index);
    out.push({ at: m.index, end: link.end, url: link.url, words: m[1] });
    last = link.end;
  }
  bare(src.length);
  return out;
}

/** Does this text hold a web address, on its own or behind words? */
export const hasLink = (text) => findLinks(text).length > 0;

/**
 * One link, opening in a new tab and telling the page it goes to nothing
 * about this one. `label` is markup -- the escaped address unless the caller
 * draws something else -- and `name` what a screen reader calls a link whose
 * label is not words. `title` is the tooltip.
 */
export const linkHtml = (url, label = esc(url), name = '', title = 'Open in a new tab') => `<a class="weblink" href="${esc(url)}"`
  + ` target="_blank" rel="noopener noreferrer" title="${esc(title)}"${name ? ` aria-label="${esc(name)}"` : ''}>${label}</a>`;

/**
 * Text as markup: escaped, with each link drawn. An address typed on its own
 * shows as typed; `[words](address)` shows the words, with the address on
 * the tooltip. Text with no link in it comes back as `esc` would give it.
 */
export function linkedText(text) {
  const src = String(text ?? '');
  let out = '';
  let last = 0;
  for (const { at, end, url, words } of findLinks(src)) {
    out += esc(src.slice(last, at))
      + (words === null ? linkHtml(url) : linkHtml(url, esc(words), '', `Open ${url} in a new tab`));
    last = end;
  }
  return out + esc(src.slice(last));
}

/**
 * The address a link field holds: the address its value starts with, typed
 * on its own or as `[words](address)`, or ''. The address ends where
 * `findLinks` ends it, so "https://a.example/form, approved" opens the form.
 */
export function fieldUrl(value) {
  const s = String(value ?? '').trim();
  const first = findLinks(s)[0];
  return first && first.at === 0 ? first.url : '';
}
