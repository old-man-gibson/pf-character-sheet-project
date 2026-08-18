/** Tests the ZIP writer against the reader that opens workbooks, and against
 *  the real characters Export all has to pack.
 *  Run: node tests/zip.test.mjs */
import { readFileSync, readdirSync } from 'node:fs';
import { CHARACTERS_DIR, hasFixtures } from './fixtures.mjs';
import { zip, deflateRaw, safeName } from '../app/js/zip.js';
import { openZip } from '../app/js/xlsx.js';

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else {
    fail++;
    console.log(`  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};
const ok = (label, cond) => {
  if (cond) pass++;
  else { fail++; console.log(`  FAIL ${label}`); }
};

const text = (bytes) => new TextDecoder().decode(bytes);

console.log('filenames -- character names are arbitrary text');
check('plain name', safeName('Angou'), 'Angou');
check('quotes go', safeName('Nicodemus "Nico" Vincent Marcone'),
  'Nicodemus Nico Vincent Marcone');
check('letters outside ascii stay', safeName('Dōkei Saburō'), 'Dōkei Saburō');
check('path separators go', safeName('a/b\\c'), 'a b c');
check('windows reserved punctuation goes', safeName('x<>:"|?*y'), 'x y');
check('digits survive', safeName('Level 20 Fighter 3'), 'Level 20 Fighter 3');
check('leading dots go', safeName('...hidden'), 'hidden');
check('trailing dot goes', safeName('name.'), 'name');
check('runs of space collapse', safeName('a    b'), 'a b');
check('empty falls back', safeName(''), 'character');
check('all-forbidden falls back', safeName('///'), 'character');
check('null falls back', safeName(null), 'character');
check('long names are cut', safeName('x'.repeat(200)).length, 80);

console.log('\nround trip -- the reader in xlsx.js opens what this writes');
{
  const archive = await zip([
    { name: 'a.json', data: '{"hello":"world"}' },
    { name: 'b.txt', data: 'plain text' },
  ]);
  const z = openZip(archive);
  check('both entries listed', z.names(), ['a.json', 'b.txt']);
  check('first entry reads back', text(await z.read('a.json')), '{"hello":"world"}');
  check('second entry reads back', text(await z.read('b.txt')), 'plain text');
  check('a missing entry is null', await z.read('nope.json'), null);
  check('has() agrees', [z.has('a.json'), z.has('nope')], [true, false]);
}

console.log('\ncontent that stresses the format');
{
  // A document carries non-ASCII in both the name and the payload, and the
  // name is where a wrong byte count would show up as a corrupt directory.
  const body = JSON.stringify({ name: 'Dōkei Saburō', note: 'ō ✦ — 日本語' });
  const archive = await zip([
    { name: 'Dōkei Saburō.json', data: body },
    { name: 'empty.json', data: '' },
    { name: 'bytes.bin', data: new Uint8Array([0, 1, 2, 255, 128]) },
  ]);
  const z = openZip(archive);
  check('utf-8 name survives', z.names()[0], 'Dōkei Saburō.json');
  check('utf-8 body survives', text(await z.read('Dōkei Saburō.json')), body);
  check('an empty entry is empty', (await z.read('empty.json')).length, 0);
  check('raw bytes survive', [...await z.read('bytes.bin')], [0, 1, 2, 255, 128]);
}

console.log('\nincompressible data is stored, not inflated');
{
  // Deflate makes random bytes bigger; storing them is the only honest answer.
  const noise = new Uint8Array(4096);
  for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) % 256;
  const random = new Uint8Array(2048);
  for (let i = 0; i < random.length; i++) random[i] = Math.floor(Math.random() * 256);

  ok('deflate really does inflate noise',
    (await deflateRaw(random)).length > random.length);

  const archive = await zip([{ name: 'noise.bin', data: random }]);
  const z = openZip(archive);
  check('stored entry still reads back', [...await z.read('noise.bin')], [...random]);
  ok('archive stayed near the payload size', archive.length < random.length + 200);

  // And the compressible case still compresses.
  const flat = new Uint8Array(4096);
  const packed = await zip([{ name: 'flat.bin', data: flat }]);
  ok('a compressible entry shrinks', packed.length < 400);
  check('and reads back', (await openZip(packed).read('flat.bin')).length, 4096);
  check('noise is untouched by all this', noise[7], (7 * 2654435761) % 256);
}

console.log('\nan empty archive is still a valid archive');
{
  const archive = await zip([]);
  check('22 bytes of end-of-directory', archive.length, 22);
  check('no entries', openZip(archive).names(), []);
}

if (!hasFixtures()) console.log('\n(private character fixtures not found -- the pack-real-characters check is skipped)');
else console.log('\nthe real characters -- what Export all actually packs');
if (hasFixtures()) {
  const dir = CHARACTERS_DIR;
  const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json');
  const entries = files.map((f) => ({
    name: f,
    data: JSON.stringify(JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'))),
  }));
  const plain = entries.reduce((n, e) => n + e.data.length, 0);

  const archive = await zip(entries);
  const z = openZip(archive);
  check('every character is in there', z.names().sort(), files.sort());

  let restored = 0;
  for (const e of entries) {
    const back = JSON.parse(text(await z.read(e.name)));
    if (JSON.stringify(back) === e.data) restored++;
  }
  check('every character survives byte for byte', restored, entries.length);

  ok('the archive is much smaller than the JSON', archive.length < plain / 4);
  console.log(`  ${files.length} characters: ${(plain / 1024).toFixed(0)} KB of JSON`
    + ` -> ${(archive.length / 1024).toFixed(0)} KB of ZIP`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
