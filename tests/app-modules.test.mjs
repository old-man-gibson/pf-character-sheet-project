/** Every browser module parses and links in Node. No fixtures, no DOM.
 *
 *  Most modules are imported by some suite, but the sheet element, the picker
 *  page, the card windows, the Forge and the planner's pages only run in a
 *  browser, so a typo in one, or an import of a name another module no longer
 *  exports, used to reach CI unseen. Importing a module here parses it and
 *  links its imports, and either failure is a SyntaxError. Any other error is
 *  a module that needs a browser to run (`HTMLElement is not defined`), which
 *  is expected and passes.
 *  Run: node tests/app-modules.test.mjs */
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pass, fail, summary, finish } from './check.mjs';

const ROOTS = ['app/js', 'forge/js', 'gm-module/planner', 'gm-module/screen'];
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory()
  ? walk(join(dir, e.name))
  : e.name.endsWith('.js') ? [join(dir, e.name)] : []));
const files = [...ROOTS.flatMap(walk), 'sw.js'].sort();

// A module that fetches its stylesheet at load says so on the console, after
// the import has settled; that is the browser it is missing, not a fault.
console.warn = () => {};
for (const file of files) {
  try {
    await import(pathToFileURL(file).href);
    pass();
  } catch (err) {
    if (err instanceof SyntaxError) fail(`  FAIL ${relative('.', file)}: ${err.message}`);
    else pass();
  }
}

finish(`\n${summary()} (${files.length} modules)`);
