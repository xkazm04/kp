#!/usr/bin/env node
// Fixtures for the ONE workflow reader. No deps — run with:
//   node scripts/review/__tests__/workflow-yaml.test.mjs
//
// Two gates read `.github/workflows`: gate-check.mjs (does the ruleset still name
// jobs that exist) and security/check-actions.mjs (is the token scoped, is every
// action pinned, does an expression reach a shell). They used to carry a reader
// each, hand-rolled against whichever workflow shapes their author happened to
// have open — so a quoted `"on":`, an `on: push` scalar or a four-space trigger
// block was read correctly by one gate and silently mis-read by the other, and
// fixing it in one propagated to nothing.
//
// The cases below are that disagreement, written down: every shape either gate
// ever needed, answered once. A shape this file does not cover is a shape the
// next reader is free to get wrong.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  blockScalarLines,
  checkoutSteps,
  eolOf,
  hasTopLevelPermissions,
  indentOf,
  jobPermissions,
  keysAt,
  listAt,
  parseWorkflow,
  rawLines,
  significantLines,
  triggersIn,
  unquote,
  usesIn,
} from '../workflow-yaml.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

// --- the primitives -----------------------------------------------------------

check('the scalar helpers do the one thing each is named for', () => {
  assert.equal(indentOf('    - run: x'), 4);
  assert.equal(indentOf('no indent'), 0);
  assert.equal(unquote('  "Alpha (js)"  '), 'Alpha (js)');
  assert.equal(unquote("'quoted'"), 'quoted');
  assert.equal(unquote('bare'), 'bare');
  assert.equal(eolOf('a\r\nb'), '\r\n');
  assert.equal(eolOf('a\nb'), '\n');
});

check('CRLF is read exactly like LF — every reader splits on both', () => {
  const lf = 'name: N\non:\n  push:\npermissions:\n  contents: read\njobs:\n  a:\n    steps:\n      - uses: x/y@v1\n';
  const crlf = lf.replace(/\n/g, '\r\n');
  assert.equal(rawLines(crlf).length, rawLines(lf).length);
  assert.deepEqual(triggersIn(crlf), triggersIn(lf));
  assert.deepEqual(usesIn(crlf), usesIn(lf));
  assert.deepEqual(parseWorkflow(crlf), parseWorkflow(lf));
});

check('structure lines drop blanks and whole-line comments, never trailing ones', () => {
  const lines = significantLines('# top\n\nname: N  # trailing\n\n  # indented comment\njobs:\n');
  assert.deepEqual(lines, ['name: N  # trailing', 'jobs:']);
});

check('keysAt reads exactly one indent level and stops at the end of the block', () => {
  const lines = significantLines('jobs:\n  alpha:\n    runs-on: x\n  beta:\n    runs-on: y\nname: after\n');
  assert.deepEqual(
    keysAt(lines, 1, 2).map((k) => k.key),
    ['alpha', 'beta'],
    'the two job ids, not `runs-on`, and not `name` at the top level',
  );
});

check('listAt reads `- item` at one indent, unquoting as it goes', () => {
  const lines = significantLines('matrix:\n  lang:\n    - js\n    - "py"\n  other:\n    - z\n');
  assert.deepEqual(listAt(lines, 2, 4), ['js', 'py']);
});

// --- the questions the gates actually ask -------------------------------------

check('the top-level `on:` keys are read, in all four spellings', () => {
  assert.deepEqual(triggersIn('on: push\njobs:\n'), ['push']);
  assert.deepEqual(triggersIn('on: [push, pull_request]\n'), ['push', 'pull_request']);
  assert.deepEqual(triggersIn('"on":\n  pull_request_target:\n  schedule:\n    - cron: "0 0 * * *"\n'), [
    'pull_request_target',
    'schedule',
  ]);
  // A four-space block: gate-check's old reader hard-coded indent 2 and returned
  // [] here — a workflow whose triggers it could not see read as "triggered by
  // nothing", which is exactly how a required check becomes unsatisfiable.
  assert.deepEqual(triggersIn('on:\n    push:\n    workflow_dispatch:\n'), ['push', 'workflow_dispatch']);
  assert.deepEqual(triggersIn('name: no triggers here\n'), []);
});

check('a trigger filter is never mistaken for a trigger', () => {
  assert.deepEqual(triggersIn('on:\n  push:\n    branches:\n      - main\n    paths:\n      - "**.ts"\n'), ['push']);
});

check('top-level permissions is a top-level question', () => {
  assert.equal(hasTopLevelPermissions('permissions:\n  contents: read\n'), true);
  assert.equal(hasTopLevelPermissions('jobs:\n  a:\n    permissions:\n      contents: read\n'), false);
});

check('every uses: is found with its real line number, comments excluded', () => {
  const wf = '# uses: not/this@v1\njobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4\n      - name: n\n        uses: "x/y@abc"\n';
  assert.deepEqual(usesIn(wf), [
    { uses: 'actions/checkout@v4', line: 5 },
    { uses: 'x/y@abc', line: 7 },
  ]);
});

check('job-level permissions come back as a scope map, an inline verdict, or null', () => {
  const wf = [
    'jobs:',
    '  scoped:',
    '    permissions:',
    '      contents: read',
    '      id-token: write',
    '    steps:',
    '      - uses: x/y@v1',
    '        with:',
    '          permissions: not-this-one',
    '  wide:',
    '    permissions: write-all',
    '  empty:',
    '    permissions: {}',
    '  inherits:',
    '    runs-on: ubuntu-latest',
    '',
  ].join('\n');
  assert.deepEqual(jobPermissions(wf), {
    scoped: { contents: 'read', 'id-token': 'write' },
    wide: 'write-all',
    empty: {},
    inherits: null,
  });
});

check('the reader stops at the end of `jobs:`', () => {
  const wf = 'jobs:\n  a:\n    runs-on: x\npermissions:\n  contents: write\n';
  assert.deepEqual(jobPermissions(wf), { a: null }, 'the trailing top-level block is not a job');
});

check('both `run:` forms are read, and an `env:` block after one is not script', () => {
  const wf = [
    'jobs:',
    '  a:',
    '    steps:',
    '      - run: echo inline',
    '      - run: |',
    '          line one',
    '          line two',
    '        env:',
    '          NOT_SCRIPT: value',
    '',
  ].join('\n');
  assert.deepEqual(
    runLinesOf(wf),
    ['echo inline', 'line one', 'line two'],
    'the env: key sits at the step indent, so the block scalar has ended',
  );
});

function runLinesOf(wf) {
  return blockScalarLines(wf, 'run').map((l) => l.text.trim());
}

check('a block indicator is never mistaken for the first line of the script', () => {
  for (const ind of ['|', '>', '|-', '>-', '|+', '>2']) {
    assert.deepEqual(runLinesOf(`    - run: ${ind}\n        only line\n`), ['only line'], ind);
  }
});

check('a checkout step owns only its own `with:` inputs', () => {
  const wf = [
    'jobs:',
    '  a:',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '        with:',
    '          ref: refs/heads/main',
    '          persist-credentials: false',
    '      - uses: other/action@v1',
    '        with:',
    '          ref: not-the-checkout',
    '',
  ].join('\n');
  const steps = checkoutSteps(wf);
  assert.equal(steps.length, 1);
  assert.deepEqual(Object.keys(steps[0].inputs).sort(), ['persist-credentials', 'ref']);
  assert.equal(steps[0].inputs.ref.value, 'refs/heads/main');
  assert.equal(steps[0].inputs.ref.line, 6);
});

check('the structural summary carries name, triggers, permissions and every job', () => {
  const wf = [
    '# a comment',
    'name: Demo',
    'on:',
    '  pull_request:',
    'permissions:',
    '  contents: read',
    'jobs:',
    '  alpha:',
    '    name: Alpha (the one that matters)',
    '    permissions:',
    '      contents: read',
    '  bare:',
    '    runs-on: ubuntu-latest',
    '',
  ].join('\n');
  const parsed = parseWorkflow(wf);
  assert.equal(parsed.name, 'Demo');
  assert.deepEqual(parsed.triggers, ['pull_request']);
  assert.equal(parsed.permissions, true);
  assert.deepEqual(
    parsed.jobs.map((j) => [j.id, j.name, j.permissions]),
    [
      ['alpha', 'Alpha (the one that matters)', true],
      ['bare', 'bare', false],
    ],
    'a job with no explicit name falls back to its id',
  );
});

check('a matrix is read as the dimensions a job name can interpolate', () => {
  const wf = [
    'jobs:',
    '  matrixed:',
    '    name: Beta (${{ matrix.lang }})',
    '    strategy:',
    '      fail-fast: false',
    '      matrix:',
    '        lang:',
    '          - js',
    '          - py',
    '',
  ].join('\n');
  assert.deepEqual(parseWorkflow(wf).jobs[0].matrix, { lang: ['js', 'py'] });
});

// --- the real tree ------------------------------------------------------------
//
// A reader that parses fixtures and mis-reads the files it is pointed at is the
// failure this whole module was extracted to end. Every committed workflow must
// come back with a name, at least one trigger and at least one job — the three
// facts both gates build every finding on.

check('every committed workflow is readable, and reads the same for both gates', () => {
  const dir = path.join(REPO_ROOT, '.github/workflows');
  const files = fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
  assert.ok(files.length > 0, 'there are workflows to read');
  for (const f of files) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const wf = parseWorkflow(text);
    assert.ok(wf.name, `${f} has a readable name`);
    assert.ok(wf.triggers.length > 0, `${f} has at least one trigger`);
    assert.ok(wf.jobs.length > 0, `${f} has at least one job`);
    // The two gates' views of the same file must not disagree.
    assert.equal(wf.permissions, hasTopLevelPermissions(text), `${f}: permissions`);
    assert.deepEqual(wf.triggers, triggersIn(text), `${f}: triggers`);
    assert.deepEqual(
      wf.jobs.map((j) => j.id).sort(),
      Object.keys(jobPermissions(text)).sort(),
      `${f}: the job set is the same job set`,
    );
  }
});

console.log(`\n${passed} checks passed.`);
