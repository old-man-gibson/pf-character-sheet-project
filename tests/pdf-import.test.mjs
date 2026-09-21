/** The PDF outline: what `pdf-import.js` makes of positioned text.
 *
 *  `readPdf` needs pdf.js and a browser and is not tested here. Everything
 *  with judgement in it -- which lines are a column, which are headings, what
 *  is furniture, what a section becomes once it is said to be talents -- is
 *  pure, and takes pages of `{ str, x, y, w, size, font }` that a test can
 *  simply write down.
 *
 *  Run: node tests/pdf-import.test.mjs */
import { outlineOf, sectionText, guessKind, guessSphere } from '../app/js/pdf-import.js';
import { readStructured, parsePaste } from '../app/js/paste-import.js';

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else { fail++; console.log(`  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
};

/* A page is 600 wide: left column from x=40, right from x=320, 11pt body in
   two cuts of one face (as a justified book is), 16pt entry headings, 24pt
   section headings, and a footer and a page number on every page. */
const W = 600;
const BODY_A = 'f1';
const BODY_B = 'f2';
const line = (str, x, y, size = 11, font = BODY_A) => ({ str, x, y, w: str.length * size * 0.5, size, font });
/** A paragraph: full lines, then a short last one, as justified type leaves it. */
const para = (words, x, y, font = BODY_A) => {
  const full = `${words} and so on until the line reaches the edge of its column`.slice(0, 48);
  return [line(full, x, y, 11, font), line(full, x, y + 13, 11, font), line(`${words} ends here.`, x, y + 26, 11, font)];
};
const stamp = (n) => [line('House Rules — draft 3, for our table only', 40, 780, 6, 'f9'), line(String(n), 290, 760, 11, 'f8')];

const page1 = { width: W, height: 800, items: [
  line('Tech Sphere', 40, 60, 24, 'f4'),
  ...para('Training in the Tech sphere teaches you devices', 40, 90),
  line('Charge Pool', 40, 140, 11, 'f5'),
  ...para('Gadgets are powered by charges', 40, 155, BODY_B),
  // The right column, drawn *first* in a real file as often as not: order in
  // `items` must not matter.
  line('Tech Talents', 320, 60, 24, 'f4'),
  line('Battery (gadget)', 320, 90, 16, 'f4'),
  ...para('You may create a battery', 320, 112, BODY_B),
  line('Camera (drone, gadget)', 320, 170, 16, 'f4'),
  ...para('You gain access to the following schematics', 320, 192),
  line('Photograph', 320, 240, 11, 'f5'),
  ...para('You create a gadget that takes photographs', 320, 255),
  ...stamp(7),
] };
const page2 = { width: W, height: 800, items: [
  // A heading whose tags run on, at the foot of the left column; its last
  // word is under it. And one in the right column on the very same row.
  line('Internal Tool (accessory, augment,', 40, 60, 16, 'f4'),
  line('gadget)', 40, 78, 16, 'f4'),
  ...para('You may create an accessory that stores a tool', 40, 100),
  line('Jet-boosters (drone, gadget)', 320, 60, 16, 'f4'),
  ...para('Jet-boosters consist of a pair of tanks', 320, 82, BODY_B),
  ...stamp(8),
] };
// A new section opens a page, as it does in a book: a heading half way down
// the left column would own everything in the right one.
const page3 = { width: W, height: 800, items: [
  line('Feats', 40, 60, 24, 'f4'),
  line('Remote Hacking (item creation)', 40, 90, 16, 'f4'),
  line('Prerequisites:', 40, 112, 11, 'f5'), line('Tech sphere, Craft 3 ranks.', 120, 112, 11, BODY_A),
  ...para('Benefit: You can hack a device from afar', 40, 128),
  ...para('More of what the feat does, in the other column', 320, 90, BODY_B),
  ...stamp(9),
] };
// Shuffled, because a PDF's drawing order is the layout program's business.
const shuffled = (p) => ({ ...p, items: [...p.items].sort((a, b) => (a.str > b.str ? 1 : -1)) });

console.log('a two-column book -- sections, entries, reading order');
const outline = outlineOf([page1, page2, page3].map(shuffled), { title: 'The Test Handbook' });
const sec = (name) => outline.sections.find((s) => s.heading === name);
check('sections are the largest headings, in reading order',
  outline.sections.map((s) => s.heading), ['Tech Sphere', 'Tech Talents', 'Feats']);
check('entries are the commonest heading style', sec('Tech Talents').entries.map((e) => e.heading),
  ['Battery (gadget)', 'Camera (drone, gadget)', 'Internal Tool (accessory, augment, gadget)', 'Jet-boosters (drone, gadget)']);
check('a heading whose tags ran on gets its last word, and its neighbour on the same row is not glued to it',
  sec('Tech Talents').entries[2].heading, 'Internal Tool (accessory, augment, gadget)');
check('the left column is read down before the right', sec('Tech Sphere').lead.startsWith('Training in the Tech sphere'), true);
check('a second body cut is body, not a run of headings', sec('Tech Talents').entries[0].text.startsWith('You may create a battery'), true);
check('a smaller heading inside an entry stays inside it, as a bold line',
  [sec('Tech Talents').entries[1].text.includes('**Photograph**'), sec('Tech Talents').entries.some((e) => e.heading === 'Photograph')], [true, false]);
check('lines are joined into paragraphs, a short last line ending one',
  sec('Tech Talents').entries[0].text.split('\n\n').length, 1);
check('the printed page number is the one cited', [sec('Tech Talents').page, sec('Feats').page], [7, 9]);
check('the footer and the page numbers are furniture, and gone',
  /draft 3|for our table|(^|\n)[789](\n|$)/.test(JSON.stringify(outline)), false);

console.log('\nwhat a section is -- guessed from its heading, settled by a person');
check('guesses', outline.sections.map(guessKind), ['sphere', 'talents', 'feats']);
check('a sphere is named by its heading, and "Legendary Talents" by the one before it',
  [guessSphere({ heading: 'Tech Talents' }), guessSphere({ heading: 'Tech Sphere' }), guessSphere({ heading: 'Legendary Talents' }, 'Tech')],
  ['Tech', 'Tech', 'Tech']);

console.log('\na section, as the document the reader takes');
const intros = new Map();
check('a sphere\'s own page is held for its talents, not written alone',
  sectionText(sec('Tech Sphere'), { kind: 'sphere', sphere: 'Tech', book: 'The Test Handbook' }, intros), '');
const doc = sectionText(sec('Tech Talents'), { kind: 'talents', sphere: 'Tech', book: 'The Test Handbook' }, intros);
const sphere = readStructured(doc).spheres[0];
check('talents read as a sphere, base abilities and all',
  [sphere.name, sphere.abilities.map((a) => a.name), sphere.talents.map((t) => t.name)],
  ['Tech', ['Charge Pool'], ['Battery', 'Camera', 'Internal Tool', 'Jet-boosters']]);
check('with their tags apart, their section and their page',
  [sphere.talents[1].tags, sphere.talents[1].group, sphere.talents[1].sources], [['drone', 'gadget'], 'Tech Talents', ['The Test Handbook p. 7']]);
const feat = readStructured(sectionText(sec('Feats'), { kind: 'feats', book: 'The Test Handbook' })).feats[0];
check('a feat keeps its type out of its name and its prerequisites as a field',
  [feat.name, feat.type, feat.prerequisites], ['Remote Hacking', 'Item Creation', 'Tech sphere, Craft 3 ranks']);
check('a section left out writes nothing', sectionText(sec('Feats'), { kind: 'skip' }), '');
const asPage = sectionText({ heading: 'Rigger (Technician Archetype)', page: 5, lead: 'Gadgeteer: He gains the Tech sphere.\n\nThis replaces trap specialist.', entries: [] }, { kind: 'text' });
check('an archetype goes to the page reader under its own name',
  parsePaste(asPage).blocks.map((b) => [b.kind, b.name, b.features.map((f) => f.replaces)]), [['archetype', 'Rigger', [['trap specialist']]]]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
