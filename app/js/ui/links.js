/**
 * ui/links.js -- web addresses in what a player wrote, drawn as links.
 *
 * Two shapes, one reading of what an address is:
 *
 *  - In prose (a note, a feat's effect), every address in the text is a link
 *    in the field's read view and the words around it are escaped as ever.
 *    See `prose()` in ui/prose.js; the box it edits in is unchanged.
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

/** Does this text hold a web address? */
export const hasLink = (text) => findUrls(text).length > 0;

/**
 * One link, opening in a new tab and telling the page it goes to nothing
 * about this one. `label` is markup -- the escaped address unless the caller
 * draws something else -- and `name` what a screen reader calls a link whose
 * label is not words.
 */
export const linkHtml = (url, label = esc(url), name = '') => `<a class="weblink" href="${esc(url)}" target="_blank"`
  + ` rel="noopener noreferrer" title="Open in a new tab"${name ? ` aria-label="${esc(name)}"` : ''}>${label}</a>`;

/**
 * Text as markup: escaped, with each address a link showing the address as
 * it was typed. Text with no address in it comes back as `esc` would give it.
 */
export function linkedText(text) {
  const src = String(text ?? '');
  let out = '';
  let last = 0;
  for (const { at, url } of findUrls(src)) {
    out += esc(src.slice(last, at)) + linkHtml(url);
    last = at + url.length;
  }
  return out + esc(src.slice(last));
}

/**
 * The address a link field holds: its value, when that starts with one, or
 * ''. The address ends where `findUrls` ends it, so "https://a.example/form,
 * approved" opens the form.
 */
export function fieldUrl(value) {
  const s = String(value ?? '').trim();
  const first = findUrls(s)[0];
  return first && first.at === 0 ? first.url : '';
}
