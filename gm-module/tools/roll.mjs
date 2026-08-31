#!/usr/bin/env node
// Unbiased dice roller for GM sessions. Every die uses crypto.randomInt so no
// number ever comes from a language model's imagination.
//
// Usage:
//   node roll.mjs [options] <expr> [expr...]
//
//   <expr>    dice expression: 1d20+7, 2d6+1d8+4, 4d6kh3, 3d6-1, d%
//             khN / klN keep the N highest / lowest dice of that term
//
// Options:
//   --label <text>   prefix the result line (who rolled, and why)
//   -n <count>       roll each expression <count> times
//   --json           machine-readable output (one JSON object per roll)
//   --secret [file]  append the result to a GM log file instead of printing it;
//                    stdout only confirms that a secret roll happened.
//                    Default file: gm-module/secret-rolls.log
//
// Exit code 1 on a malformed expression; nothing is rolled in that case.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SECRET_LOG = path.join(here, '..', 'secret-rolls.log');
const MAX_DICE = 1000;
const MAX_SIDES = 1_000_000;

function parseArgs(argv) {
  const opts = { label: '', times: 1, json: false, secret: false, secretFile: DEFAULT_SECRET_LOG, exprs: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--label') opts.label = argv[++i] ?? '';
    else if (a === '-n') opts.times = Math.max(1, Number(argv[++i]) || 1);
    else if (a === '--json') opts.json = true;
    else if (a === '--secret') {
      opts.secret = true;
      if (argv[i + 1] && !argv[i + 1].startsWith('-') && !looksLikeExpr(argv[i + 1])) opts.secretFile = argv[++i];
    } else opts.exprs.push(a);
  }
  return opts;
}

function looksLikeExpr(s) {
  return /^[+-]?(\d*d(\d+|%)(k[hl]\d+)?|\d+)([+-](\d*d(\d+|%)(k[hl]\d+)?|\d+))*$/i.test(s);
}

// Parse "2d6+1d8kh1-2" into signed terms.
function parseExpr(expr) {
  const cleaned = expr.replace(/\s+/g, '');
  if (!looksLikeExpr(cleaned)) throw new Error(`cannot parse "${expr}"`);
  const terms = [];
  const re = /([+-]?)(\d*)d(\d+|%)(k([hl])(\d+))?|([+-]?)(\d+)/gi;
  let m;
  while ((m = re.exec(cleaned)) !== null) {
    if (m[8] !== undefined && m[3] === undefined) {
      terms.push({ sign: m[7] === '-' ? -1 : 1, flat: Number(m[8]) });
    } else {
      const count = m[2] === '' ? 1 : Number(m[2]);
      const sides = m[3] === '%' ? 100 : Number(m[3]);
      const keep = m[4] ? { mode: m[5].toLowerCase(), n: Number(m[6]) } : null;
      if (count < 1 || count > MAX_DICE) throw new Error(`die count out of range in "${expr}"`);
      if (sides < 2 || sides > MAX_SIDES) throw new Error(`die sides out of range in "${expr}"`);
      if (keep && (keep.n < 1 || keep.n > count)) throw new Error(`keep count out of range in "${expr}"`);
      terms.push({ sign: m[1] === '-' ? -1 : 1, count, sides, keep });
    }
  }
  if (!terms.length) throw new Error(`cannot parse "${expr}"`);
  return terms;
}

function rollTerm(term) {
  if (term.flat !== undefined) return { flat: term.flat * term.sign };
  const dice = Array.from({ length: term.count }, () => crypto.randomInt(1, term.sides + 1));
  let kept = dice;
  if (term.keep) {
    const sorted = [...dice].sort((a, b) => b - a);
    kept = term.keep.mode === 'h' ? sorted.slice(0, term.keep.n) : sorted.slice(-term.keep.n);
  }
  const sum = kept.reduce((a, b) => a + b, 0) * term.sign;
  return { dice, kept, sum, sides: term.sides, sign: term.sign, keep: term.keep };
}

function rollExpr(expr) {
  const terms = parseExpr(expr).map(rollTerm);
  const total = terms.reduce((a, t) => a + (t.flat ?? t.sum), 0);
  return { expr, total, terms };
}

function formatRoll(r, label) {
  const detail = r.terms.map(t => {
    if (t.flat !== undefined) return t.flat >= 0 ? `+${t.flat}` : `${t.flat}`;
    const shown = t.keep
      ? `${t.dice.join(',')} keep ${t.kept.join(',')}`
      : t.dice.join(',');
    return `${t.sign < 0 ? '-' : ''}[d${t.sides}: ${shown}]`;
  }).join(' ');
  const prefix = label ? `${label}: ` : '';
  return `${prefix}${r.expr} = ${r.total}   ${detail}`;
}

const opts = parseArgs(process.argv.slice(2));
if (!opts.exprs.length) {
  console.error('usage: node roll.mjs [--label <text>] [-n <count>] [--json] [--secret [file]] <expr> [expr...]');
  process.exit(1);
}

try {
  const lines = [];
  for (const expr of opts.exprs) {
    for (let i = 0; i < opts.times; i++) {
      const r = rollExpr(expr);
      lines.push(opts.json ? JSON.stringify({ label: opts.label || undefined, ...r }) : formatRoll(r, opts.label));
    }
  }
  if (opts.secret) {
    const stamp = new Date().toISOString();
    fs.mkdirSync(path.dirname(opts.secretFile), { recursive: true });
    fs.appendFileSync(opts.secretFile, lines.map(l => `${stamp}  ${l}`).join('\n') + '\n');
    console.log(`secret roll recorded (${lines.length} result${lines.length === 1 ? '' : 's'})`);
  } else {
    console.log(lines.join('\n'));
  }
} catch (err) {
  console.error(`roll.mjs: ${err.message}`);
  process.exit(1);
}
