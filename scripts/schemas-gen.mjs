#!/usr/bin/env node
// `npm run typecheck` needs Python. This is where that stops being a surprise.
//
// THE GAP THIS CLOSES: `AGENTS.md` tells an agent to verify a change with three
// commands, and the first of them — `npm run typecheck` — runs
// `python -m pipeline.jobfit.codegen` before tsc, because the TypeScript schemas
// are generated from the Python models. On a machine that has just cloned this
// repository and run `npm ci`, that command was:
//
//     'python' is not recognized as an internal or external command
//     npm ERR! code 1
//
// …which says nothing about Python being a documented prerequisite, nothing
// about `requirements.txt`, and nothing about which of the three documented
// commands is the one that needs it. `guidance:check` proves the gate table and
// ci.yml name the same steps; nothing checked that the documented commands SUCCEED
// from a cold clone, so the first agent to try discovered the prerequisite as a
// confusing failure. This turns it into a sentence.
//
// WHAT IT DOES, and deliberately nothing more: find an interpreter, run the
// codegen through it, pass the arguments and the exit code straight back. The
// behaviour on a machine that is already set up is identical to the command it
// replaced — `python` is tried first, for exactly that reason.
//
//   npm run schemas:gen     # write the generated TypeScript
//   npm run schemas:check    # fail if it would differ (the --check pass-through)
//   KP_PYTHON=/path/to/python npm run schemas:gen
//
// EXIT CODES: the interpreter's own · 1 when no interpreter could be started at
// all, which is the case that used to read as a generic npm failure.

import { spawnSync } from 'node:child_process';

const MODULE = 'pipeline.jobfit.codegen';

/**
 * Interpreters to try, in order. `python` first because that is what the
 * documented command used and what CI's `setup-python` puts on PATH — so a
 * working checkout runs exactly what it ran before. `py -3` is the Windows
 * launcher, which is present on installs where `python` is not.
 */
export const CANDIDATES = [
  ...(process.env.KP_PYTHON ? [[process.env.KP_PYTHON, []]] : []),
  ['python', []],
  ['python3', []],
  ['py', ['-3']],
];

/** The prerequisite, said once, where the failure happens. */
const PREREQUISITES = [
  '',
  'schemas:gen generates app/**/generated TypeScript from the Python models in pipeline/jobfit/,',
  'so it is a prerequisite of `npm run typecheck` and `npm run build` — not an optional extra.',
  '',
  'From a fresh clone:',
  '',
  '  1. Install Python 3.12 (the version .github/workflows/ci.yml pins).',
  '  2. pip install -r requirements.txt',
  '  3. npm ci',
  '',
  'Point this at a specific interpreter with KP_PYTHON=/path/to/python.',
  'The full list of what runs and what it needs is in AGENTS.md.',
];

const say = (lines) => process.stderr.write(`${lines.join('\n')}\n`);

export function main(argv, { spawn = spawnSync } = {}) {
  const tried = [];
  for (const [cmd, prefix] of CANDIDATES) {
    const args = [...prefix, '-m', MODULE, ...argv];
    let res = spawn(cmd, args, { stdio: 'inherit' });
    // The command this replaced ran through npm's shell, so it worked where the
    // interpreter on PATH is a `.cmd`/`.bat` shim (scoop, conda, the Windows
    // launcher) — which Node refuses to spawn directly. Falling back to a shell
    // keeps every checkout that worked before working, and the arguments are
    // fixed literal tokens, so there is nothing here for a shell to re-read.
    if (res.error && res.error.code !== 'ENOENT' && res.error.code !== 'EACCES') {
      res = spawn(cmd, args, { stdio: 'inherit', shell: true });
    }
    // ENOENT means this interpreter is not on PATH — try the next one. Anything
    // else means it RAN, and its verdict is the answer: retrying a different
    // interpreter after a real failure would hide the error and change which
    // Python the generated file came from.
    if (res.error && (res.error.code === 'ENOENT' || res.error.code === 'EACCES')) {
      tried.push(`${cmd} (${res.error.code})`);
      continue;
    }
    if (res.error) {
      say([`schemas:gen: could not run ${cmd} — ${res.error.message}`, ...PREREQUISITES]);
      return 1;
    }
    if (res.status !== 0) {
      say([
        '',
        `schemas:gen: \`${cmd} -m ${MODULE}\` exited ${res.status}.`,
        '',
        'If the error above is a missing module, the pipeline dependencies are not installed:',
        '',
        '  pip install -r requirements.txt',
        '',
        'If it is a generation failure, the message above is the real one — this line is only',
        'here so the prerequisite is never the thing you have to guess at.',
      ]);
    }
    return res.status ?? 1;
  }

  say([`schemas:gen: no Python interpreter found. Tried: ${tried.join(', ')}.`, ...PREREQUISITES]);
  return 1;
}

// `exitCode` rather than `exit()`: the diagnosis above is written to a pipe in
// CI, and exiting the instant after a write is how the last lines of it go
// missing — which would be a particularly silly way to lose a message whose only
// job is to be read.
if (process.argv[1]?.endsWith('schemas-gen.mjs')) process.exitCode = main(process.argv.slice(2));
