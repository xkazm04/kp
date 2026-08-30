#!/usr/bin/env node
// Wire `.githooks/`, and SAY SO — including when it did not work.
//
// THE GAP THIS CLOSES: `prepare` used to be
//
//     git config core.hooksPath .githooks || exit 0
//
// which is silent on success and silent on failure. `.githooks/pre-push` is the
// only thing standing between a direct push to `main` and CI — it runs both
// review lenses, typecheck, lint, design:check and build — and `.githooks/commit-msg`
// is what keeps the CHANGELOG cuttable. A contributor or an agent whose hooks
// never installed (no git on PATH during install, a `core.hooksPath` already set
// by a parent config, an npm run with `--ignore-scripts`) got zero signal and
// pushed straight past a gate they believed was on.
//
// Loud, but never fatal: a failed hook install must not break `npm ci` in CI or in
// the Docker build, where hooks are meaningless. The exit code stays 0 for
// install; `--check` is the one that has teeth, and it runs where the answer
// matters.
//
//   node scripts/hooks/install.mjs            # `prepare` runs this
//   npm run hooks:check                       # are the hooks wired AND intact?
//
// --check EXIT CODES: 0 wired and intact · 1 a hook is missing, or points at a
// script that no longer exists.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const HOOKS_DIR = '.githooks';

// Every hook this repository ships, and what it is for. A hook that disappears
// from `.githooks/` is a gate that disappeared; `--check` names it.
export const EXPECTED_HOOKS = [
  { name: 'commit-msg', why: 'conventional-commit subjects — the CHANGELOG is cut from them' },
  { name: 'pre-push', why: 'the gate on pushes to main: both review lenses, typecheck, lint, design, build' },
];

export function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
}

/**
 * The npm scripts and node entry points a hook shells out to.
 *
 * This is the drift that bites: rename an npm script and `pre-push` still runs,
 * still prints "gate green", and has silently stopped checking one of the five
 * things it claims to check — because `npm run <gone>` inside a `||` chain is
 * just a failure the hook was written to treat as "blocked", or worse, a step
 * whose removal nobody notices. Reading the hook back is cheap; trusting it is not.
 */
export function referencesIn(source) {
  const npmScripts = [...source.matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]);
  const nodeFiles = [...source.matchAll(/node (scripts\/[\w./-]+\.mjs)/g)].map((m) => m[1]);
  return { npmScripts: [...new Set(npmScripts)], nodeFiles: [...new Set(nodeFiles)] };
}

/** Pure. `pkg` is the parsed package.json; `hooks` is `[{name, source}]`. */
export function runChecks(pkg, hooks, fileExists) {
  const out = [];
  const scripts = pkg.scripts ?? {};

  for (const expected of EXPECTED_HOOKS) {
    const hook = hooks.find((h) => h.name === expected.name);
    if (!hook) {
      out.push({
        rule: 'missing-hook',
        message: `${HOOKS_DIR}/${expected.name} does not exist.`,
        fix: `That hook is ${expected.why}. Restore it, or delete it from EXPECTED_HOOKS on purpose.`,
      });
      continue;
    }
    const { npmScripts, nodeFiles } = referencesIn(hook.source);
    for (const s of npmScripts) {
      if (!(s in scripts)) {
        out.push({
          rule: 'dangling-script',
          message: `${HOOKS_DIR}/${expected.name} runs \`npm run ${s}\`, which package.json no longer defines.`,
          fix: 'Point the hook at the new name. Until then that step of the gate cannot pass or fail — it errors.',
        });
      }
    }
    for (const f of nodeFiles) {
      if (!fileExists(f)) {
        out.push({
          rule: 'dangling-file',
          message: `${HOOKS_DIR}/${expected.name} runs \`node ${f}\`, which does not exist.`,
          fix: 'Point the hook at the file that replaced it.',
        });
      }
    }
  }

  // `prepare` is the only thing that wires the hooks on a fresh clone.
  if (!/hooks[/\\]install\.mjs/.test(scripts.prepare ?? '') && !/core\.hooksPath/.test(scripts.prepare ?? '')) {
    out.push({
      rule: 'prepare-not-wiring-hooks',
      message: 'package.json `prepare` does not install the hooks.',
      fix: `Set it to \`node scripts/hooks/install.mjs\`, or nothing in ${HOOKS_DIR}/ runs on a fresh clone.`,
    });
  }

  return out;
}

function readHooks() {
  const dir = path.join(REPO_ROOT, HOOKS_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => fs.statSync(path.join(dir, f)).isFile())
    .map((f) => ({ name: f, source: fs.readFileSync(path.join(dir, f), 'utf8') }));
}

function install() {
  let current = null;
  try {
    current = git(['config', '--get', 'core.hooksPath']);
  } catch {
    current = null; // unset, or not a repository — both handled below
  }

  if (current === HOOKS_DIR) {
    console.log(`hooks: core.hooksPath is already ${HOOKS_DIR} (commit-msg, pre-push).`);
    return;
  }

  try {
    git(['config', 'core.hooksPath', HOOKS_DIR]);
    console.log(`hooks: core.hooksPath -> ${HOOKS_DIR} (commit-msg, pre-push are live).`);
    if (current) console.log(`hooks: replaced a previous value (${current}).`);
  } catch (err) {
    // stderr, and in the words a reader can act on. NOT an error exit: `npm ci`
    // in CI and in the Docker build must not fail because a checkout has no git
    // identity — but the operator must not be able to believe the gate is on.
    console.error('');
    console.error('  hooks: COULD NOT SET core.hooksPath — .githooks/pre-push and commit-msg WILL NOT RUN.');
    console.error(`  reason: ${err.message.split('\n')[0]}`);
    console.error('  Your pushes to main are NOT gated locally. Fix with:');
    console.error(`      git config core.hooksPath ${HOOKS_DIR}`);
    console.error('  (Harmless in CI and in the Docker image — neither commits.)');
    console.error('');
  }
}

function check() {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const findings = runChecks(pkg, readHooks(), (f) => fs.existsSync(path.join(REPO_ROOT, f)));

  let hooksPath = null;
  try {
    hooksPath = git(['config', '--get', 'core.hooksPath']);
  } catch {
    /* unset */
  }
  if (hooksPath !== HOOKS_DIR) {
    console.log(`hooks: core.hooksPath is ${hooksPath ?? 'unset'} in THIS checkout — run \`npm run hooks:install\`.`);
    console.log('       (Not a failure: a CI checkout never commits, so it never needs them.)');
  }

  if (findings.length === 0) {
    console.log('hooks: both hooks present, and every command they run still exists.');
    return 0;
  }
  for (const f of findings) console.log(`BLOCK  [${f.rule}] ${f.message}\n       ${f.fix}`);
  return 1;
}

if (process.argv[1]?.endsWith('install.mjs')) {
  if (process.argv.includes('--check')) process.exit(check());
  else install();
}
