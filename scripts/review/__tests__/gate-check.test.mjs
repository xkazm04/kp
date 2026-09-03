#!/usr/bin/env node
// Fixtures for the gating checks. No deps — run with:
//   node scripts/review/__tests__/gate-check.test.mjs
//
// Two tools are covered here because they answer one question between them:
// is the gate actually wired, end to end?
//   gate-check.mjs      the ruleset agrees with the workflows
//   hooks/install.mjs   the local half of the gate is installed and intact
//
// The THIRD tool that reads these same workflow files, `security/check-actions.mjs`,
// used to be covered here too — which meant the security gate's own `test:security`
// script did not run a single one of its fixtures. Its cases now live beside it, in
// scripts/security/__tests__/check-actions.test.mjs, and the shared workflow reader
// they both use is pinned in scripts/review/__tests__/workflow-yaml.test.mjs.
//
// The failure mode every case below exists to prevent is the same one: a check
// that reads well, passes, and is no longer connected to anything.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  REVIEW_CONTEXTS,
  RULESET_PATH,
  checkNamesFor,
  loadWorkflows,
  parseWorkflow,
  requiredContexts,
  runChecks as runGateChecks,
  verifyLive,
} from '../gate-check.mjs';
import { EXPECTED_HOOKS, dockerPreparesHooks, referencesIn, runChecks as runHookChecks } from '../../hooks/install.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}
async function checkAsync(name, fn) {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
}

const has = (findings, rule) => findings.some((f) => f.rule === rule);
const blocking = (findings) => findings.filter((f) => f.severity === 'blocking');

// --- the workflow reader ------------------------------------------------------

const WF = `# a comment
name: Demo
on:
  pull_request:
  push:
    branches:
      - main

permissions:
  contents: read

jobs:
  alpha:
    name: Alpha (the one that matters)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@abc
  matrixed:
    name: Beta (\${{ matrix.lang }})
    strategy:
      fail-fast: false
      matrix:
        lang:
          - js
          - py
    steps:
      - run: echo hi
`;

check('the reader finds triggers, the permissions block and every job name', () => {
  const wf = parseWorkflow(WF);
  assert.equal(wf.name, 'Demo');
  assert.deepEqual(wf.triggers.sort(), ['pull_request', 'push']);
  assert.equal(wf.permissions, true);
  assert.deepEqual(
    wf.jobs.map((j) => j.id),
    ['alpha', 'matrixed'],
  );
  assert.equal(wf.jobs[0].name, 'Alpha (the one that matters)');
});

check('a matrix job reports one check name per combination', () => {
  const wf = parseWorkflow(WF);
  const { names, unresolved } = checkNamesFor(wf.jobs[1]);
  assert.deepEqual(names, ['Beta (js)', 'Beta (py)']);
  assert.equal(unresolved, false);
});

check('an expression the reader cannot expand is reported, never guessed', () => {
  const { unresolved } = checkNamesFor({ name: 'X (${{ github.ref }})', matrix: {} });
  assert.equal(unresolved, true);
});

check('a job with no explicit name falls back to its id', () => {
  const wf = parseWorkflow('name: N\non:\n  push:\npermissions:\n  contents: read\njobs:\n  build:\n    runs-on: ubuntu-latest\n');
  assert.equal(wf.jobs[0].name, 'build');
});

// --- the ruleset <-> workflow agreement --------------------------------------

const ruleset = (contexts) => ({
  name: 'r',
  enforcement: 'active',
  rules: [{ type: 'required_status_checks', parameters: { required_status_checks: contexts.map((c) => ({ context: c })) } }],
});
const workflows = (triggers, jobs) => [{ file: '.github/workflows/x.yml', triggers, jobs, permissions: true, name: 'x' }];
const job = (name, matrix = {}) => ({ id: name, name, matrix, permissions: false });

check('a required check no job reports is blocking', () => {
  const f = runGateChecks(ruleset([...REVIEW_CONTEXTS, 'Ghost']), workflows(['pull_request'], REVIEW_CONTEXTS.map((c) => job(c))));
  assert.ok(has(f, 'unknown-check'));
  assert.equal(blocking(f).length, 1);
});

check('renaming a gated job is caught — the whole point of this file', () => {
  const jobs = [job('Constitution (deterministic, blocking)'), job('Agent review — v2')];
  const f = runGateChecks(ruleset(REVIEW_CONTEXTS), workflows(['pull_request'], jobs));
  assert.ok(has(f, 'unknown-check'));
});

check('a required check that never runs on a PR can never be satisfied', () => {
  const f = runGateChecks(ruleset(REVIEW_CONTEXTS), workflows(['push'], REVIEW_CONTEXTS.map((c) => job(c))));
  assert.ok(has(f, 'not-on-pull-request'));
});

check('a review lens missing from the required set is called out by name', () => {
  const f = runGateChecks(ruleset([REVIEW_CONTEXTS[0]]), workflows(['pull_request'], REVIEW_CONTEXTS.map((c) => job(c))));
  assert.ok(has(f, 'review-not-required'));
});

check('an "evaluate" ruleset is a dry run, not a gate', () => {
  const rs = { ...ruleset(REVIEW_CONTEXTS), enforcement: 'evaluate' };
  const f = runGateChecks(rs, workflows(['pull_request'], REVIEW_CONTEXTS.map((c) => job(c))));
  assert.ok(has(f, 'ruleset-inactive'));
});

check('a ruleset with no required_status_checks rule is blocking', () => {
  const f = runGateChecks({ name: 'r', enforcement: 'active', rules: [] }, workflows(['pull_request'], [job('a')]));
  assert.ok(has(f, 'no-required-checks'));
});

check('a PR job that is not required is a note, not a block', () => {
  const jobs = [...REVIEW_CONTEXTS.map((c) => job(c)), job('Nice to have')];
  const f = runGateChecks(ruleset(REVIEW_CONTEXTS), workflows(['pull_request'], jobs));
  assert.ok(has(f, 'ungated-job'));
  assert.equal(blocking(f).length, 0);
});

check('a workflow with no jobs is a stub, and stubs report green having done nothing', () => {
  const f = runGateChecks(ruleset(REVIEW_CONTEXTS), [
    { file: '.github/workflows/stub.yml', triggers: ['pull_request'], jobs: [], permissions: true },
    ...workflows(['pull_request'], REVIEW_CONTEXTS.map((c) => job(c))),
  ]);
  assert.ok(has(f, 'unparsed-workflow'));
});

// --- the live half degrades loudly, never quietly ----------------------------

await checkAsync('with no token the live half reports that it did not run', async () => {
  const r = await verifyLive(ruleset([]), { repo: 'o/r', token: null });
  assert.equal(r.ran, false);
  assert.match(r.why, /GH_TOKEN/);
});

await checkAsync('a repository with no ruleset applied is blocking, not a shrug', async () => {
  const r = await verifyLive(ruleset(REVIEW_CONTEXTS), {
    repo: 'o/r',
    token: 't',
    fetchImpl: async () => ({ ok: true, json: async () => [] }),
  });
  assert.equal(r.ran, true);
  assert.ok(has(r.findings, 'ruleset-not-applied'));
});

await checkAsync('a live ruleset missing a required context is blocking', async () => {
  const live = { id: 1, name: 'r', target: 'branch', enforcement: 'active', rules: ruleset([REVIEW_CONTEXTS[0]]).rules };
  const r = await verifyLive(ruleset(REVIEW_CONTEXTS), {
    repo: 'o/r',
    token: 't',
    fetchImpl: async (url) => ({ ok: true, json: async () => (url.endsWith('/1') ? live : [{ id: 1, name: 'r', target: 'branch' }]) }),
  });
  assert.ok(has(r.findings, 'live-check-not-required'));
});

await checkAsync('an API refusal is "did not run", not "all clear"', async () => {
  const r = await verifyLive(ruleset([]), { repo: 'o/r', token: 't', fetchImpl: async () => ({ ok: false, status: 403 }) });
  assert.equal(r.ran, false);
  assert.match(r.why, /403/);
});

// --- the local half: hooks ----------------------------------------------------

check('the commands a hook shells out to are extracted', () => {
  const r = referencesIn('npm run typecheck || exit 1\nnode scripts/review/agent-review.mjs --base x\nnpm run design:check\n');
  assert.deepEqual(r.npmScripts, ['typecheck', 'design:check']);
  assert.deepEqual(r.nodeFiles, ['scripts/review/agent-review.mjs']);
});

check('a hook pointing at a renamed npm script is blocking', () => {
  const hooks = EXPECTED_HOOKS.map((h) => ({ name: h.name, source: 'npm run gone-away\n' }));
  const f = runHookChecks({ scripts: { prepare: 'node scripts/hooks/install.mjs' } }, hooks, () => true);
  assert.ok(has(f, 'dangling-script'));
});

check('a hook pointing at a deleted script file is blocking', () => {
  const hooks = EXPECTED_HOOKS.map((h) => ({ name: h.name, source: 'node scripts/review/gone.mjs\n' }));
  const f = runHookChecks({ scripts: { prepare: 'node scripts/hooks/install.mjs' } }, hooks, () => false);
  assert.ok(has(f, 'dangling-file'));
});

check('a missing hook is named, with what it was for', () => {
  const f = runHookChecks({ scripts: { prepare: 'node scripts/hooks/install.mjs' } }, [], () => true);
  assert.equal(f.filter((x) => x.rule === 'missing-hook').length, EXPECTED_HOOKS.length);
});

check('a `prepare` that stopped installing the hooks is blocking', () => {
  const hooks = EXPECTED_HOOKS.map((h) => ({ name: h.name, source: '' }));
  const f = runHookChecks({ scripts: { prepare: 'echo hi' } }, hooks, () => true);
  assert.ok(has(f, 'prepare-not-wiring-hooks'));
});

check('a `prepare` that swallows its own failure is blocking', () => {
  // The shape this repo carried for years. It cannot distinguish "installed"
  // from "could not install" from "the installer was not even there", which is
  // why a machine with no hooks looked exactly like a machine with hooks.
  const hooks = EXPECTED_HOOKS.map((h) => ({ name: h.name, source: '' }));
  for (const prepare of [
    'node scripts/hooks/install.mjs || exit 0',
    'node scripts/hooks/install.mjs || true',
    'node scripts/hooks/install.mjs ||  exit 0 ',
  ]) {
    assert.ok(has(runHookChecks({ scripts: { prepare } }, hooks, () => true), 'prepare-swallows-failure'), prepare);
  }
  assert.deepEqual(runHookChecks({ scripts: { prepare: 'node scripts/hooks/install.mjs' } }, hooks, () => true), []);
});

check('the image must carry the installer, since `npm ci` runs `prepare`', () => {
  // The coupling the swallow was hiding: with `|| exit 0` gone, a Dockerfile
  // that copies only the manifests before `npm ci` fails the IMAGE BUILD on a
  // missing module — discovered at release time, by an operator.
  assert.equal(dockerPreparesHooks('COPY package.json ./\nRUN npm ci\n'), false);
  assert.equal(dockerPreparesHooks('COPY package.json ./\nCOPY scripts/hooks ./scripts/hooks\nRUN npm ci\n'), true);
  assert.equal(dockerPreparesHooks('COPY scripts/hooks ./scripts/hooks\n'), true, 'no npm ci, nothing to couple');
  assert.equal(dockerPreparesHooks('RUN npm ci\nCOPY scripts/hooks ./scripts/hooks\n'), false, 'order matters');
});

check('the shipped Dockerfile carries the installer before it runs npm ci', () => {
  assert.equal(dockerPreparesHooks(fs.readFileSync(path.join(REPO_ROOT, 'Dockerfile'), 'utf8')), true);
});

// --- and finally: the real tree, right now ------------------------------------
//
// The cases above prove the rules fire. This one proves they are pointed at
// something: it runs all three checks over THIS repository and requires them
// clean, so the fixtures cannot drift into describing a gate that no longer
// matches the files.

check('the committed ruleset agrees with the committed workflows', () => {
  const rs = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, RULESET_PATH), 'utf8'));
  const f = runGateChecks(rs, loadWorkflows(REPO_ROOT));
  assert.deepEqual(blocking(f), [], `blocking findings:\n${JSON.stringify(blocking(f), null, 2)}`);
  for (const c of REVIEW_CONTEXTS) assert.ok(requiredContexts(rs).includes(c), `${c} must be required`);
});

check('the shipped hooks still point at commands that exist', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const dir = path.join(REPO_ROOT, '.githooks');
  const hooks = fs.readdirSync(dir).map((f) => ({ name: f, source: fs.readFileSync(path.join(dir, f), 'utf8') }));
  const f = runHookChecks(pkg, hooks, (rel) => fs.existsSync(path.join(REPO_ROOT, rel)));
  assert.deepEqual(f, [], `findings:\n${JSON.stringify(f, null, 2)}`);
});

console.log(`\n${passed} checks passed.`);
