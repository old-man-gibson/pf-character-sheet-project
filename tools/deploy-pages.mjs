// Deploy the committed tree to Cloudflare Pages from the command line.
//
//   node tools/deploy-pages.mjs [--project <name>] [--branch <name>] [--ref <git ref>] [--dry-run]
//
// Never run `wrangler pages deploy .` from a checkout of this repository. Wrangler
// uploads every file under the directory it is given -- it skips node_modules, .git
// and a few of its own names, and reads no ignore file -- so the gitignored
// `private/` roster, the `.claude/` worktrees and any stray folder would all go
// to the public site. This script uploads what git has, and nothing else: it
// exports a commit with `git archive` into a temporary directory, hands that to
// wrangler, and deletes it afterwards. Uncommitted changes do not ship, which is
// the point.
//
// The first run needs `npx wrangler login` (a browser sign-in to the Cloudflare
// account) and creates the project if it does not exist. `--dry-run` only does the
// export and reports what would be uploaded.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const project = option('--project', 'character-sheets');
const branch = option('--branch', 'main');
const ref = option('--ref', 'HEAD');
const dryRun = args.includes('--dry-run');

/** Run a command to completion, or throw with its exit status. */
const run = (cmd, cmdArgs, opts = {}) => {
  const res = spawnSync(cmd, cmdArgs, { cwd: root, stdio: 'inherit', ...opts });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`${cmd} ${cmdArgs.join(' ')} failed (${res.status ?? res.signal})`);
};

const resolved = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: root, encoding: 'utf8' });
const commit = resolved.status === 0 ? resolved.stdout.trim() : '';
if (!commit) {
  console.error(`Not a commit: ${ref}`);
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), 'pages-deploy-'));
const site = join(work, 'site');
let failed = false;
try {
  run('git', ['archive', '--format=tar', '-o', join(work, 'site.tar'), commit]);
  mkdirSync(site);
  // Relative names with cwd set: some tars read a Windows drive letter as a host.
  run('tar', ['-xf', 'site.tar', '-C', 'site'], { cwd: work });

  const top = readdirSync(site);
  console.log(`Exported ${commit.slice(0, 7)}: ${countFiles(site)} files, top level: ${top.join(' ')}`);
  for (const forbidden of ['private', '.claude', 'node_modules']) {
    if (existsSync(join(site, forbidden))) throw new Error(`Refusing to deploy: ${forbidden}/ is in the export.`);
  }
  if (dryRun) {
    console.log('Dry run: nothing uploaded.');
  } else {
    // npx is a .cmd on Windows, which Node will only start through a shell; one
    // quoted string keeps the arguments intact either way. Run from inside the
    // export: wrangler takes the Pages Functions from the `functions/` folder of
    // the directory it is run in, and that has to be the committed one too.
    const quote = (s) => `"${s}"`;
    const line = ['npx wrangler pages deploy .',
      '--project-name', quote(project), '--branch', quote(branch),
      '--commit-hash', commit, '--commit-dirty=false'].join(' ');
    run(line, [], { shell: true, cwd: site });
  }
} catch (err) {
  failed = true;
  console.error(err.message);
} finally {
  rmSync(work, { recursive: true, force: true });
}
if (failed) process.exit(1);

function countFiles(dir) {
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    n += entry.isDirectory() ? countFiles(join(dir, entry.name)) : 1;
  }
  return n;
}
