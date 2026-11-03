#!/usr/bin/env node
/**
 * check-names.mjs -- names the code uses that nothing declares, imports and
 * locals nothing uses, and a few other slips a moved block of code leaves.
 *
 * The TypeScript checker reads the plain JavaScript (allowJs + checkJs) and
 * only the diagnostics below are reported; its type errors are not, because
 * nothing here is annotated. Three programs, one per place the code runs:
 * the browser (app, forge, gm-module pages, the browser test pages), Node
 * (every .mjs) and Cloudflare (worker.js, functions/, sw.js).
 *
 * Usage: node tools/check-names.mjs [--typescript <path to the package>]
 * Exits 1 when it reports anything that is not in tools/check-names-allow.json.
 * The repository installs nothing, so TypeScript comes from wherever it is:
 * CI installs a pinned copy outside the checkout and passes its path.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readArgs } from './lib/cli.mjs';

const args = readArgs(['typescript']);
const root = process.env.CHECK_NAMES_ROOT ? path.resolve(process.env.CHECK_NAMES_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tsPath = args.opt('typescript') || process.env.TYPESCRIPT || 'typescript';
let ts;
try { ts = createRequire(path.join(root, 'package.json'))(tsPath); } catch {
  console.error(`check-names: TypeScript not found (${tsPath}). Install it with: npm install --no-save typescript@5.9.3`);
  process.exit(2);
}

/* What is reported. Everything else the checker says is about types. */
const CODES = {
  2304: 'name not found', 2552: 'name not found', 2580: 'name not found', 2582: 'name not found',
  2583: 'name not found', 2591: 'name not found', 2662: 'name not found', 2663: 'name not found',
  18004: 'shorthand property with no value in scope',
  2448: 'used before its declaration', 2449: 'used before its declaration',
  2683: '`this` in a function that is not a method',
  2305: 'no such export', 2614: 'no such export', 2724: 'no such export', 2459: 'no such export', 2460: 'no such export',
  2307: 'module not found',
  6133: 'declared but never used', 6138: 'declared but never used', 6192: 'import never used',
  6196: 'declared but never used', 6198: 'destructured but never used', 6199: 'declared but never used',
  7027: 'unreachable code', 7028: 'unused label', 1117: 'duplicate key in an object literal',
  2554: 'wrong number of arguments', 2555: 'wrong number of arguments',
};

const SHIMS = {
  // Node: imports from node:* are `any`, and the few Node globals the DOM lib lacks.
  node: `declare module 'node:*';
declare var process: any; declare var Buffer: any; declare var global: any;
declare var setImmediate: any; declare var clearImmediate: any;`,
  // Cloudflare's runtime globals.
  worker: 'declare var WebSocketPair: any; declare var HTMLRewriter: any;',
  browser: '',
};

const walk = (dir, acc = []) => {
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) { if (!['node_modules', 'vendor', 'fixtures'].includes(ent.name)) walk(p, acc); }
    else if (/\.m?js$/.test(ent.name)) acc.push(p);
  }
  return acc;
};
const rel = (f) => path.relative(root, path.resolve(f)).split(path.sep).join('/');
const files = [
  ...['app/js', 'forge/js', 'gm-module', 'functions', 'tools', 'tests'].flatMap((d) => walk(path.join(root, d))),
  ...['worker.js', 'sw.js'].map((f) => path.join(root, f)).filter((f) => fs.existsSync(f)),
];
const groupOf = (f) => {
  const r = rel(f);
  if (r === 'worker.js' || r === 'sw.js' || r.startsWith('functions/')) return 'worker';
  if (r.endsWith('.mjs') && !/^tests\/(.*-)?browser\.mjs$/.test(r)) return 'node';
  return 'browser';
};

const base = {
  allowJs: true, checkJs: true, noEmit: true, skipLibCheck: true, maxNodeModuleJsDepth: 0,
  target: 'es2023', module: 'esnext', moduleResolution: 'bundler', moduleDetection: 'force', resolveJsonModule: true,
  noUnusedLocals: true, noUnusedParameters: false, allowUnreachableCode: false, allowUnusedLabels: false,
  noImplicitThis: true, types: [],
};
const LIBS = { browser: ['es2023', 'dom', 'dom.iterable'], node: ['es2023', 'dom', 'dom.iterable'], worker: ['es2023', 'webworker'] };

const allowFile = path.join(root, 'tools/check-names-allow.json');
const allow = fs.existsSync(allowFile) ? JSON.parse(fs.readFileSync(allowFile, 'utf8')) : [];
const allowed = (f) => allow.some((a) => a.file === f.file && a.code === f.code && (!a.name || a.name === f.name));

const nodeAt = (sf, pos) => {
  let found = sf;
  const visit = (n) => { if (n.getStart(sf) <= pos && pos < n.getEnd()) { found = n; ts.forEachChild(n, visit); } };
  ts.forEachChild(sf, visit);
  return found;
};
// Whether a position is in the comments before a token rather than in code.
const inComment = (sf, pos) => {
  let node = sf;
  for (;;) {
    let next = null;
    for (const c of node.getChildren(sf)) {
      if (c.pos <= pos && pos < c.getStart(sf)) return true;
      if (c.getStart(sf) <= pos && pos < c.end) { next = c; break; }
    }
    if (!next) return pos >= node.end ? false : node.kind === ts.SyntaxKind.EndOfFileToken;
    node = next;
  }
};
// Too many or too few arguments is only worth a line when the callee is a
// function written as one. A callback whose default is `() => {}` reads to
// the checker as taking nothing, which is not what its callers mean.
const plainCallee = (checker, n) => {
  let c = n;
  while (c && !ts.isCallExpression(c) && !ts.isNewExpression(c)) c = c.parent;
  if (!c) return false;
  const e = c.expression;
  let sym = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(e) ? e.name : e);
  if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
  const d = sym?.valueDeclaration;
  if (!d || d.getSourceFile().isDeclarationFile) return false;
  return ts.isFunctionDeclaration(d) || ts.isMethodDeclaration(d)
    || (ts.isVariableDeclaration(d) && !!d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)));
};

// Window properties a missing import or a missing local resolves to instead
// of failing: `name` is the window's name, `status` its status text, `open`
// opens one. Code that means the window writes `window.open`.
const MASKING = new Set(['name', 'status', 'event', 'length', 'origin', 'parent', 'top', 'close', 'open',
  'stop', 'find', 'closed', 'opener', 'frames', 'external', 'screen', 'orientation', 'toolbar', 'menubar']);
const maskingUses = (sf, checker, out) => {
  const visit = (n) => {
    if (ts.isIdentifier(n) && MASKING.has(n.text) && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n)) {
      const sym = ts.isShorthandPropertyAssignment(n.parent)
        ? checker.getShorthandAssignmentValueSymbol(n.parent) : checker.getSymbolAtLocation(n);
      const d = sym?.declarations?.[0];
      if (d && d.getSourceFile().hasNoDefaultLib && (ts.isVariableDeclaration(d) || ts.isFunctionDeclaration(d))) {
        const { line, character } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
        out.push({ file: rel(sf.fileName), line: line + 1, col: character + 1, code: 'window-global', name: n.text,
          what: 'a window property, not a variable', message: `'${n.text}' is not declared here and resolves to window.${n.text}; write window.${n.text} if that is meant.` });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
};

const t0 = Date.now();
const findings = [];
for (const group of ['browser', 'node', 'worker']) {
  const roots = files.filter((f) => groupOf(f) === group);
  if (!roots.length) continue;
  const { options, errors } = ts.convertCompilerOptionsFromJson({ ...base, lib: LIBS[group] }, root);
  if (errors.length) throw new Error(ts.flattenDiagnosticMessageText(errors[0].messageText, '\n'));
  const host = ts.createCompilerHost(options);
  const shimPath = path.join(root, `__check_names_${group}.d.ts`).split(path.sep).join('/');
  if (SHIMS[group]) {
    const { getSourceFile, fileExists, readFile } = host;
    const same = (f) => path.resolve(f).toLowerCase() === path.resolve(shimPath).toLowerCase();
    host.getSourceFile = (f, ...rest) => (same(f) ? ts.createSourceFile(f, SHIMS[group], ts.ScriptTarget.Latest) : getSourceFile(f, ...rest));
    host.fileExists = (f) => same(f) || fileExists(f);
    host.readFile = (f) => (same(f) ? SHIMS[group] : readFile(f));
  }
  const program = ts.createProgram({ rootNames: SHIMS[group] ? [...roots, shimPath] : roots, options, host });
  const checker = program.getTypeChecker();
  const mine = new Set(roots.map((f) => path.resolve(f).toLowerCase()));
  for (const sf of program.getSourceFiles()) {
    if (!mine.has(path.resolve(sf.fileName).toLowerCase())) continue;
    if (group !== 'node') maskingUses(sf, checker, findings);
    for (const d of [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)]) {
      if (!(d.code in CODES) || d.start === undefined) continue;
      const { line, character } = sf.getLineAndCharacterOfPosition(d.start);
      if (inComment(sf, d.start)) continue;           // a JSDoc type, not code
      const n = nodeAt(sf, d.start);
      if (d.code === 2307 && !/['"]\.\.?\//.test(sf.text.slice(d.start, d.start + d.length))) continue;  // only relative paths
      if ((d.code === 2554 || d.code === 2555) && !plainCallee(checker, n)) continue;
      findings.push({
        file: rel(sf.fileName), line: line + 1, col: character + 1, code: d.code,
        name: ts.isIdentifier(n) || ts.isPrivateIdentifier(n) ? n.text : sf.text.slice(d.start, d.start + Math.min(d.length, 40)),
        what: CODES[d.code], message: ts.flattenDiagnosticMessageText(d.messageText, ' '),
      });
    }
  }
}

const fresh = findings.filter((f) => !allowed(f));
const stale = allow.filter((a) => !findings.some((f) => f.file === a.file && f.code === a.code && (!a.name || a.name === f.name)));
const gh = !!process.env.GITHUB_ACTIONS;
for (const f of fresh) {
  console.log(gh ? `::error file=${f.file},line=${f.line},col=${f.col}::${f.what}: ${f.message}`
    : `${f.file}:${f.line}:${f.col}  ${f.what}: ${f.message}`);
}
for (const a of stale) console.log(`${gh ? '::warning::' : ''}allow-list entry no longer needed: ${JSON.stringify(a)}`);
console.log(`check-names: typescript ${ts.version}, ${files.length} files, ${fresh.length} reported, `
  + `${findings.length - fresh.length} allowed, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(fresh.length ? 1 : 0);
