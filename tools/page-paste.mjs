/**
 * A saved web page, as the paste the reader already understands.
 *
 * The paste box reads a page a player selected and copied: `readSphere` finds
 * the breadcrumb, takes the table of contents as the list of headings, and
 * cuts the article on exactly those strings. Copying is fine for one page and
 * tedious for a campaign wiki's worth, and a copy made by hand loses the odd
 * line to wherever the selection happened to stop.
 *
 * So this does not read the page. It takes the page's HTML -- a file saved
 * from the browser, or an address -- and lays it out the way a browser's copy
 * would: title, breadcrumb, `Fold`, `Table of Contents`, the headings, then
 * the article with a heading a line and a table's cells tabbed. That is
 * written as a `.txt`, which `scrape-pack.mjs` reads like any other paste.
 * The reader stays the only reader.
 *
 *   node tools/page-paste.mjs <page.html | url>… --out <dir>
 *   node tools/scrape-pack.mjs <dir> --out <packs> --one "Name"
 *   node tools/pack-merge.mjs <target pack.json> <that pack.json>
 *
 * It knows one layout: a page with `#page-title`, `#breadcrumbs`, a `#toc`
 * and a `#page-content`, which is the one the reader was written against. An
 * address is tried over plain `http://`, because some hosts send the secure
 * one straight back to it and a fetcher that insists goes round for ever.
 *
 * Pages are content, and content is its author's: write them somewhere
 * git-ignored (`private/`) rather than into `data/`, which ships.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const at = argv.indexOf('--out');
const out = at === -1 ? null : argv[at + 1];
const urls = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1] === '--out'));
if (!urls.length || !out) {
  console.error('usage: node tools/page-paste.mjs <page.html | url>… --out <dir>');
  process.exit(2);
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', raquo: '»', laquo: '«', ndash: '–', mdash: '—', times: '×', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' };
const decode = (s) => String(s)
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&(\w+);/g, (m, n) => ENTITIES[n] ?? m);
const textOf = (html) => decode(String(html).replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

/** The element opening at `start`, to its matching close: a div inside a div is still inside. */
function element(html, start, tag) {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = start;
  let depth = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, re.lastIndex);
  }
  return html.slice(start);
}

/** Every element of `tag` whose opening tag matches `test`, removed. */
function without(html, tag, test) {
  let s = html;
  const open = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
  for (let m = open.exec(s); m; m = open.exec(s)) {
    if (!test(m[0])) continue;
    const whole = element(s, m.index, tag);
    s = s.slice(0, m.index) + s.slice(m.index + whole.length);
    open.lastIndex = m.index;
  }
  return s;
}

/**
 * The article as a browser copies it: a heading or a paragraph is a line with
 * a blank one after it, a table row is a line with its cells tabbed, and
 * everything else is the text with its tags gone.
 */
function render(html) {
  return decode(html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/<\/t[dh]>\s*<t[dh]\b[^>]*>/gi, '\t')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/?(?:table|tbody|thead)\b[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<hr\b[^>]*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n')
    .replace(/<h[1-6]\b[^>]*>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<p\b[^>]*>/gi, '\n\n')
    .replace(/<\/(?:p|div|ul|ol|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
    .split('\n').map((l) => l.replace(/[  ]+/g, ' ').replace(/ ?\t ?/g, '\t').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

mkdirSync(out, { recursive: true });
for (const url of urls) {
  let html;
  if (/^https?:/i.test(url)) {
    const res = await fetch(url.replace(/^https:/, 'http:'), { redirect: 'follow' });
    if (!res.ok) { console.error(`${url}: ${res.status}`); process.exitCode = 1; continue; }
    html = await res.text();
  } else html = readFileSync(url, 'utf8');

  const crumbAt = html.search(/<div id="breadcrumbs"/i);
  const crumbs = crumbAt === -1 ? '' : textOf(element(html, crumbAt, 'div'));
  const tocAt = html.search(/<div id="toc-list"/i);
  const toc = tocAt === -1 ? [] : [...element(html, tocAt, 'div').matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => textOf(m[1])).filter(Boolean);

  const bodyAt = html.search(/<div id="page-content"/i);
  let body = bodyAt === -1 ? '' : element(html, bodyAt, 'div');
  // The contents box is written out by hand below, in the reader's order.
  const tocBox = body.search(/<div id="toc"/i);
  if (tocBox !== -1) body = body.replace(element(body, tocBox, 'div'), '');
  // A tab that is not showing holds an *older* copy of the page, which a
  // real Ctrl+A never picks up; and the tab strip itself is furniture.
  body = without(body, 'div', (open) => /display:\s*none/i.test(open));
  body = without(body, 'ul', (open) => /yui-nav/i.test(open));

  const titleAt = html.search(/<div id="page-title"/i);
  const title = titleAt === -1 ? '' : textOf(element(html, titleAt, 'div'));
  const name = title || crumbs.split('»').pop().trim() || url.split('/').pop();
  // The title goes above the breadcrumb, where the page has it: that line is
  // the sphere's name to the reader, and without it the name is guessed from
  // the first `X Talents` heading -- which may be a sub-group's, not the sphere's.
  // No blank line between the contents and the article: the page has none,
  // and the reader was written against the page.
  const paste = [name, crumbs, 'Fold', 'Table of Contents', ...toc].join('\n') + '\n' + render(body) + '\n';
  const file = join(out, `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.txt`);
  writeFileSync(file, paste, 'utf8');
  console.log(`${name.padEnd(16)} ${String(toc.length).padStart(4)} headings  ${(paste.length / 1024).toFixed(0).padStart(4)} KB  ${file}`);
}
