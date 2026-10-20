/** Tests for web links in what a player wrote: which text is an address, how
 *  it is drawn, the prose read view that shows it, and the ↗ beside a link
 *  field. Run: node tests/links.test.mjs */
import { blankDocument } from '../app/js/convert.js';
import { Character } from '../app/js/model.js';
import { fieldUrl, findLinks, findUrls, hasLink, linkedText } from '../app/js/ui/links.js';
import { prose, renderedProse } from '../app/js/ui/prose.js';
import { linkField, text } from '../app/js/ui/fields.js';
import { itemText } from '../app/js/ui/rows.js';
import { noteField, richText } from '../app/js/ui/talents.js';

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else {
    fail++;
    console.log(`  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};
const urls = (s) => findUrls(s).map((u) => u.url);
/** The hrefs a piece of markup links to, as written in the attribute. */
const hrefs = (html) => [...html.matchAll(/<a\b[^>]*\shref="([^"]*)"/g)].map((m) => m[1]);

console.log('which text is an address');
check('https', urls('see https://example.com/a'), ['https://example.com/a']);
check('http', urls('see http://example.com'), ['http://example.com']);
check('the scheme in capitals', urls('HTTPS://EXAMPLE.COM/UP'), ['HTTPS://EXAMPLE.COM/UP']);
check('two in one line', urls('https://a.example and http://b.example/p#f'), ['https://a.example', 'http://b.example/p#f']);
check('a query string and a port', urls('https://a.example:8080/p?x=1&y=2'), ['https://a.example:8080/p?x=1&y=2']);
check('an apostrophe inside one', urls("https://a.example/?q=Mage's+Disjunction"), ["https://a.example/?q=Mage's+Disjunction"]);
for (const other of ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'ftp://a.example', 'file:///c:/x',
  'mailto:a@b.org', 'www.example.com']) {
  check(`not a link: ${other}`, urls(other), []);
}
check('not inside a word', urls('xhttps://a.example'), []);
check('a scheme with nothing after it is no address', urls('https:// and https://.'), []);
check('hasLink agrees', [hasLink('go to https://a.example'), hasLink('no address'), hasLink(null)], [true, false, false]);

console.log('where an address ends');
for (const [label, typed, url] of [
  ['a full stop', 'see https://a.example/x.', 'https://a.example/x'],
  ['a comma', 'https://a.example, then', 'https://a.example'],
  ['a colon, a semicolon, ! and ?', 'https://a.example/q?!;:', 'https://a.example/q'],
  ['a closing bracket it did not open', '(see https://a.example/x)', 'https://a.example/x'],
  ['but one it opened stays', 'https://wiki.example/Fire_(element)', 'https://wiki.example/Fire_(element)'],
  ['both at once', '(https://wiki.example/Fire_(element)).', 'https://wiki.example/Fire_(element)'],
  ['square brackets', '[https://a.example]', 'https://a.example'],
  ['angle brackets', '<https://a.example>', 'https://a.example'],
  ['double quotes', '"https://a.example"', 'https://a.example'],
  ['single quotes', "'https://a.example'", 'https://a.example'],
  ['curly quotes', '“https://a.example”', 'https://a.example'],
  ['a space', 'https://a.example/x y', 'https://a.example/x'],
  ['a formula', 'https://a.example/{= level}', 'https://a.example/'],
]) {
  check(`ends before ${label}`, urls(typed), [url]);
}

console.log('drawn as links, everything else escaped');
{
  const html = linkedText('Rules: https://a.example/x?a=1&b=2. <b>bold</b> & "quoted"');
  check('the link opens in a new tab and tells it nothing about the sheet',
    html.includes('<a class="weblink" href="https://a.example/x?a=1&amp;b=2" target="_blank" rel="noopener noreferrer"'), true);
  check('it shows the address as typed', html.includes('>https://a.example/x?a=1&amp;b=2</a>'), true);
  check('the full stop stays outside it', html.includes('</a>. '), true);
  check('the words around it are escaped', html.includes('&lt;b&gt;bold&lt;/b&gt; &amp; &quot;quoted&quot;'), true);
  check('one link', hrefs(html).length, 1);
  check('text with no address comes back escaped', linkedText('a <b> & c'), 'a &lt;b&gt; &amp; c');
  check('nothing is nothing', [linkedText(''), linkedText(null)], ['', '']);
  // A payload right after an address: the address stops at the quote, and
  // what follows is text.
  const bad = linkedText('https://a.example/"><svg/onload=x(1)> https://b.example/\'><svg/onload=x(1)>');
  check('a payload after an address does not open a tag', bad.includes('<svg'), false);
  check('and the addresses before it are still links', hrefs(bad), ['https://a.example/', 'https://b.example/']);
  check('an apostrophe in an address is escaped in its href', hrefs(linkedText("https://a.example/it's")), ['https://a.example/it&#39;s']);
  check('javascript: stays text', linkedText('javascript:alert(1)'), 'javascript:alert(1)');
}

console.log('words as a link: [words](address)');
{
  /** Each link's address and what it shows, in order. */
  const shown = (s) => [...linkedText(s).matchAll(/<a\b[^>]*\shref="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((m) => [m[1], m[2]]);
  const html = linkedText('Read [the rules](https://a.example/rules?a=1&b=2). Then ask.');
  check('the words are the link, and the address is where it goes',
    shown('Read [the rules](https://a.example/rules). Then ask.'), [['https://a.example/rules', 'the rules']]);
  check('it opens in a new tab and tells it nothing about the sheet',
    html.includes('<a class="weblink" href="https://a.example/rules?a=1&amp;b=2" target="_blank" rel="noopener noreferrer"'), true);
  check('its tooltip says where it goes', html.includes('title="Open https://a.example/rules?a=1&amp;b=2 in a new tab"'), true);
  check('the brackets and the address are not shown', [html.includes('['), html.includes('](')], [false, false]);
  check('the text after it stays text', html.endsWith('</a>. Then ask.'), true);
  check('findLinks says where its source starts and ends, and what the words are',
    findLinks('Read [the rules](https://a.example/r).'),
    [{ at: 5, end: 37, url: 'https://a.example/r', words: 'the rules' }]);
  check('a pair of brackets inside the address is part of it',
    shown('[Fire](https://wiki.example/Fire_(element))'), [['https://wiki.example/Fire_(element)', 'Fire']]);
  check('a bracket around the whole of it is not',
    shown('(see [Fire](https://wiki.example/Fire))'), [['https://wiki.example/Fire', 'Fire']]);
  check('words and an address in one line, in order',
    shown('[a](https://a.example) and https://b.example.'), [['https://a.example', 'a'], ['https://b.example', 'https://b.example']]);
  check('two side by side', shown('[a](https://a.example)[b](https://b.example)'), [['https://a.example', 'a'], ['https://b.example', 'b']]);
  check('an address as the words', shown('[https://a.example](https://b.example)'), [['https://b.example', 'https://a.example']]);
  check('hasLink sees one', hasLink('[the map](https://a.example/map)'), true);
  check('words with markup in them are escaped',
    linkedText('[<b>bold</b> & "so"](https://a.example)').includes('>&lt;b&gt;bold&lt;/b&gt; &amp; &quot;so&quot;</a>'), true);
  for (const [label, typed] of [
    ['javascript:', '[a](javascript:alert(1))'], ['data:', '[a](data:text/html,x)'], ['ftp:', '[a](ftp://a.example)'],
    ['no scheme', '[a](www.a.example)'], ['a scheme alone', '[a](https://)'],
  ]) {
    check(`not a link: ${label}`, [linkedText(typed).includes('<a'), hasLink(typed)], [false, false]);
  }
  // Where the words or the address are not well formed, what is left is
  // text, and an address in it is still a link as typed.
  for (const [label, typed, url] of [
    ['no words', '[](https://a.example)', 'https://a.example'],
    ['words that are only spaces', '[  ](https://a.example)', 'https://a.example'],
    ['words over two lines', '[two\nlines](https://a.example)', 'https://a.example'],
    ['a bracket in the words', '[a [b]](https://a.example)', 'https://a.example'],
    ['a space in the address', '[a](https://a.example/x y)', 'https://a.example/x'],
    ['a formula in the words', '[{= level} pages](https://a.example)', 'https://a.example'],
  ]) {
    check(`${label}: the address is shown as typed`, shown(typed), [[url, url]]);
  }
  const bad = linkedText('[a](https://a.example/"><svg/onload=x(1)>) [Zq<svg/onload=x(1)>](https://b.example)');
  check('a payload in the address or the words does not open a tag', bad.includes('<svg'), false);
  check('and the addresses are still links', hrefs(bad), ['https://a.example/', 'https://b.example']);
}

console.log('prose fields: the read view');
{
  const model = new Character(blankDocument({ name: 'Links', level: 4 }));
  model.recompute();
  const field = (value) => prose(model, 'data-item="notes|0|body"', value, 4);
  const plain = field('Ask the GM about the map');
  check('no formula and no address: the box alone', [plain.includes('prose-view'), plain.includes('has-view')], [false, false]);
  const linked = field('Map: https://a.example/map. Ask the GM.');
  check('an address alone gets the read view', [linked.includes('has-view'), linked.includes('class="prose-view"')], [true, true]);
  check('which says it edits, not that it computes', linked.includes('title="Click to edit"'), true);
  check('with the address a link', hrefs(linked), ['https://a.example/map']);
  check('and the box keeps the text as typed',
    linked.includes('<textarea data-item="notes|0|body" data-kind="text" rows="4" spellcheck="false">Map: https://a.example/map. Ask the GM.</textarea>'), true);
  const both = field('{= level * 2} hit points, see https://a.example/hp');
  check('a formula and an address: both in the one view',
    [/class="tok value"[^>]*>8</.test(both), hrefs(both)], [true, ['https://a.example/hp']]);
  check('which still says it computes', both.includes('title="Click to edit the formulas"'), true);
  check('an address the box is escaped in', field('https://a.example/</textarea><svg>').includes('<svg'), false);
  check('renderedProse draws no link unless asked', hrefs(renderedProse(model, '{= 1} at https://a.example')), []);
  check('and draws one when asked', hrefs(renderedProse(model, '{= 1} at https://a.example', null, { links: true })), ['https://a.example']);
  const worded = field('Read [the rules](https://a.example/rules) first.');
  check('words as a link get the read view, which shows the words',
    [worded.includes('has-view'), hrefs(worded), />the rules<\/a> first\.<\/span>/.test(worded)], [true, ['https://a.example/rules'], true]);
  check('and the box keeps them as typed', worded.includes('>Read [the rules](https://a.example/rules) first.</textarea>'), true);
  const mixed = field('{= level * 2} hit points: [the table](https://a.example/hp)');
  check('a formula beside words as a link: both in the one view',
    [/class="tok value"[^>]*>8</.test(mixed), mixed.includes('>the table</a>')], [true, true]);
}

console.log('notes with a table in them');
{
  const model = new Character(blankDocument({ name: 'Table', level: 1 }));
  const note = 'From https://a.example/rules.\nLevel\tSource\n1st\thttps://b.example/one\n2nd\tbook';
  check('the table view links the text and the cells', hrefs(richText(note)), ['https://a.example/rules', 'https://b.example/one']);
  const cell = noteField(model, 'data-item="x|0|notes"', note);
  check('and the note cell shows it as its read view', [cell.includes('has-view'), hrefs(cell).length], [true, 2]);
  check('a cell with words as a link shows the words',
    richText('Level\tSource\n1st\t[the book](https://b.example/one)').includes('>the book</a></td>'), true);
}

console.log('a field that holds one address');
{
  const box = (v) => linkField(itemText('extras.approvals', 0, 'link', v, 'https://…', true), v);
  const ok = box('https://a.example/approval');
  check('an ↗ beside the box once it holds an address', hrefs(ok), ['https://a.example/approval']);
  check('the ↗ is labelled for a screen reader', ok.includes('aria-label="Open the link in a new tab">↗</a>'), true);
  check('the box and the ↗ share the row', ok.startsWith('<span class="pair link"><input type="text"'), true);
  check('no ↗ while it holds no address', [box(''), box('ask the GM'), box('see https://a.example')].map((h) => h.includes('↗')),
    [false, false, false]);
  check('nor for another scheme', box('javascript:alert(1)').includes('<a '), false);
  check('the ↗ opens the address at the start of the value', fieldUrl('https://a.example/form, approved by Sam'), 'https://a.example/form');
  check('or the address behind the words it starts with', hrefs(box('[the form](https://a.example/form), approved')),
    ['https://a.example/form']);
  check('a path field works the same way', hrefs(linkField(text('templates.0.link', 'https://a.example/t'), 'https://a.example/t')),
    ['https://a.example/t']);
  check('an address with a quote in it stays in its attribute',
    linkField(text('templates.0.link', 'https://a.example/"><svg>'), 'https://a.example/"><svg>').includes('<svg'), false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
