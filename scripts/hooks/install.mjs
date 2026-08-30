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
// THAT GUARANTEE LIVES HERE, NOT IN package.json. `prepare` used to read
// `node scripts/hooks/install.mjs || exit 0`, which made the two outcomes this
// file works hardest to distinguish — "installed" and "could not install, here is
// why" — indistinguishable from a THIRD one: the installer itself crashing and
// npm swallowing it. The `|| exit 0` is gone; the `catch` at the bottom is what
// keeps install non-fatal, and unlike a shell operator it prints what happened.
//
//   node scripts/hooks/install.mjs            # `prepare` runs this
//   npm run hooks:check                       # are the hooks wired AND intact?
//
// --check EXIT CODES: 0 wired and intact · 1 a hook is missing, points at a
// script that no longer exists, `prepare` swallows its own failure again, or the
// Dockerfile runs `npm ci` without this installer in the build context.

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
  const prepare = scripts.prepare ?? '';
  if (!/hooks[/\\]install\.mjs/.test(prepare) && !/core\.hooksPath/.test(prepare)) {
    out.push({
      rule: 'prepare-not-wiring-hooks',
      message: 'package.json `prepare` does not install the hooks.',
      fix: `Set it to \`node scripts/hooks/install.mjs\`, or nothing in ${HOOKS_DIR}/ runs on a fresh clone.`,
    });
  } else if (/\|\|\s*(exit\s+0|true|:)\s*$/.test(prepare.trim())) {
    // `… || exit 0` was here for years, and it is the whole reason this gap was
    // invisible: it collapses three different outcomes — installed / could not
    // install, here is why / the installer was not even there — into one silent
    // success. The non-fatal guarantee belongs in install.mjs's own catch, which
    // prints. A shell operator cannot print.
    out.push({
      rule: 'prepare-swallows-failure',
      message: 'package.json `prepare` ends in a `|| exit 0`-style swallow.',
      fix: 'Drop it. install.mjs already exits 0 on every failure it can have AND says which one happened; ' +
        'the operator only removes the saying. If it was there because the Dockerfile runs `npm ci` without ' +
        'the script present, copy scripts/hooks into the image before that line instead.',
    });
  }

  return out;
}

/**
 * The coupling the `|| exit 0` was hiding: the image runs `npm ci` — and so
 * `prepare` — against a context holding only the manifests, so a `prepare` that
 * can fail on a missing file breaks `docker build` and nothing else. With the
 * swallow gone, the installer must be in the build context BEFORE `npm ci`.
 *
 * Pure: give it the Dockerfile text.
 */
export function dockerPreparesHooks(dockerfile) {
  const lines = dockerfile.split(/\r?\n/);
  const install = lines.findIndex((l) => /^\s*RUN\s+.*\bnpm ci\b/.test(l));
  if (install === -1) return true; // no `npm ci` in the image — nothing to couple
  return lines.slice(0, install).some((l) => /^\s*COPY\s+.*scripts[/\\]hooks/.test(l));
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

  const dockerfile = path.join(REPO_ROOT, 'Dockerfile');
  if (fs.existsSync(dockerfile) && !dockerPreparesHooks(fs.readFileSync(dockerfile, 'utf8'))) {
    findings.push({
      rule: 'docker-npm-ci-without-installer',
      message: 'The Dockerfile runs `npm ci` without scripts/hooks/ in the build context.',
      fix: 'npm runs `prepare` at the end of `npm ci`, so the image build would die on a missing module. ' +
        'Add `COPY scripts/hooks ./scripts/hooks` above that line — do not re-add a `|| exit 0` to package.json.',
    });
  }

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
  if (process.argv.includes('--check')) {
    process.exit(check());
  } else {
    try {
      install();
    } catch (err) {
      // Anything install() did not already handle — a broken checkout, an
      // unreadable package.json, a bug in this file. Still exit 0 (`prepare`
      // must not break `npm ci`), but never silently: an operator who sees
      // nothing here concludes the hooks are on.
      console.error('');
      console.error('  hooks: THE INSTALLER ITSELF FAILED — .githooks/ is NOT wired.');
      console.error(`  reason: ${err?.stack ?? err}`);
      console.error(`      git config core.hooksPath ${HOOKS_DIR}`);
      console.error('');
    }
  }
}
