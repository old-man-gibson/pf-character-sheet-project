// Deploy the committed tree to Cloudflare from the command line.
//
//   node tools/deploy-site.mjs [--ref <git ref>] [--dry-run]
//
// Do not run `wrangler deploy` from a checkout of this repository. Wrangler uploads
// the whole assets directory (minus .assetsignore), so a checkout's gitignored
// `private/` roster, `.claude/` worktrees and stray folders are one missed ignore
// line away from the public site. This script uploads what git has, and nothing
// else: it exports a commit with `git archive` into a temporary directory, runs
// wrangler there with the committed wrangler.jsonc, and deletes it afterwards.
// Uncommitted changes do not ship, which is the point.
//
// The first run needs `npx wrangler login` (a browser sign-in to the Cloudflare
// account). `--dry-run` only does the export and reports what would be uploaded.

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
    // npx is a .cmd on Windows, which Node will only start through a shell. Run
    // from inside the export so the committed wrangler.jsonc and worker.js are
    // the ones that go.
    run('npx wrangler deploy', [], { shell: true, cwd: site });
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
