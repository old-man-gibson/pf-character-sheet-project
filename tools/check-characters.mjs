// Validate exports without rewriting them or printing their contents.
// node tools/check-characters.mjs private/review-characters
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Character, inspectDocument } from '../app/js/model.js';
import { countChanges } from '../app/js/history.js';

const inputs = process.argv.slice(2);
if (!inputs.length) {
  console.error('Usage: node tools/check-characters.mjs <directory or JSON files>');
  process.exit(1);
}
const files = inputs.flatMap((path) => statSync(path).isDirectory()
  ? readdirSync(path).filter((name) => name.endsWith('.json') && name !== 'index.json').map((name) => join(path, name))
  : [path]);
let failed = 0;
for (const file of files) {
  try {
    const original = JSON.parse(readFileSync(file, 'utf8'));
    const inspected = inspectDocument(structuredClone(original));
    if (!inspected.ok) throw new Error(inspected.error);
    let model = new Character(original);
    void model.hpState;
    const baseline = structuredClone(model.toJSON());
    for (let pass = 0; pass < 5; pass++) {
      model = new Character(JSON.parse(JSON.stringify(model.toJSON())));
      void model.hpState;
      const changes = countChanges(baseline, model.toJSON());
      if (changes) throw new Error(`${changes} values drifted after reload ${pass + 1}`);
    }
    console.log(`PASS ${file}: imports and survives five export/reload cycles`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${file}: ${error.message}`);
  }
}
console.log(`${files.length - failed} passed, ${failed} failed`);
process.exitCode = failed || !files.length ? 1 : 0;
