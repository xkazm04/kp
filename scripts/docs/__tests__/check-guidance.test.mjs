#!/usr/bin/env node
// Fixtures for the guidance-manifest check. No deps — run with:
//   node scripts/docs/__tests__/check-guidance.test.mjs
//
// The failure this whole file guards against is quiet: three guidance documents
// that agree today, one canonical declaration in .ai/manifest.yaml that nobody
// re-reads, and six months later a tool loading the wrong one. The last two
// cases run the checks against the REAL tree, which is what makes the manifest a
// contract rather than a comment.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  MANIFEST_PATH,
  REPO_ROOT,
  commandsIn,
  declaredPaths,
  loadGuidanceFiles,
  parseGuidance,
  runChecks,
} from '../check-guidance.mjs';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

const has = (findings, rule) => findings.some((f) => f.rule === rule);
const file = (p, text) => ({ path: p, text });
const SCRIPTS = { lint: 'eslint .', typecheck: 'tsc' };

// --- the reader ---------------------------------------------------------------

check('the guidance block is read out of the manifest, comments and all', () => {
  const g = parseGuidance(
    ['repo:', '  name: kp', '', '# a comment', 'guidance:', '  canonical: .claude/CLAUDE.md', '  projections:', '    - AGENTS.md', '    - CLAUDE.md', 'skills:', '  - architect', ''].join('\n'),
  );
  assert.equal(g.canonical, '.claude/CLAUDE.md');
  assert.deepEqual(g.projections, ['AGENTS.md', 'CLAUDE.md']);
});

check('the reader stops at the next top-level key, not at the end of the file', () => {
  const g = parseGuidance(['guidance:', '  canonical: A.md', 'skills:', '  - architect', '  - conform'].join('\n'));
  assert.deepEqual(g.projections, [], 'the skills list is not a projection list');
});

check('an absent guidance block reads as null, never as "fine"', () => {
  assert.equal(parseGuidance('repo:\n  name: kp\n'), null);
  assert.ok(has(runChecks(null, [file('CLAUDE.md', 'x')], SCRIPTS), 'canonical-missing'));
});

// --- the rules ----------------------------------------------------------------

check('a canonical that names a file which is not there is a finding', () => {
  const f = runChecks({ canonical: 'gone/CLAUDE.md', projections: [] }, [], SCRIPTS);
  assert.ok(has(f, 'canonical-missing'));
});

check('a guidance file nobody declared is a finding', () => {
  const files = [file('.claude/CLAUDE.md', 'the rules'), file('GEMINI.md', 'other rules')];
  const f = runChecks({ canonical: '.claude/CLAUDE.md', projections: [] }, files, SCRIPTS);
  assert.ok(has(f, 'projection-undeclared'));
  assert.match(f.find((x) => x.rule === 'projection-undeclared').message, /GEMINI\.md/);
});

check('a projection that never names the canonical file is a finding', () => {
  // This is the two-hop path the manifest exists to close: a file whose only
  // route to the rules is an include a tool may not expand.
  const files = [file('.claude/CLAUDE.md', 'the rules'), file('CLAUDE.md', '@AGENTS.md\n')];
  const f = runChecks({ canonical: '.claude/CLAUDE.md', projections: ['CLAUDE.md'] }, files, SCRIPTS);
  assert.ok(has(f, 'projection-not-pointing'));

  const fixed = runChecks(
    { canonical: '.claude/CLAUDE.md', projections: ['CLAUDE.md'] },
    [file('.claude/CLAUDE.md', 'the rules'), file('CLAUDE.md', '@AGENTS.md\nCanonical: .claude/CLAUDE.md\n')],
    SCRIPTS,
  );
  assert.deepEqual(fixed, []);
});

check('a declared projection that does not exist is a finding', () => {
  const f = runChecks({ canonical: '.claude/CLAUDE.md', projections: ['AGENTS.md'] }, [file('.claude/CLAUDE.md', 'x')], SCRIPTS);
  assert.ok(has(f, 'projection-missing'));
});

check('an npm script the guidance names and package.json has dropped is a finding', () => {
  const files = [file('.claude/CLAUDE.md', 'Verify with `npm run typecheck` and `npm run test:gone`.')];
  const f = runChecks({ canonical: '.claude/CLAUDE.md', projections: [] }, files, SCRIPTS);
  assert.ok(has(f, 'dangling-command'));
  assert.equal(f.filter((x) => x.rule === 'dangling-command').length, 1, 'typecheck exists, test:gone does not');
});

check('every command form the guidance actually uses is extracted', () => {
  assert.deepEqual(commandsIn('npm run start -- --port N\nnpm run test:python:gate\nnpm run start\n'), ['start', 'test:python:gate']);
});

// --- against the real tree ----------------------------------------------------

check(`${MANIFEST_PATH} declares a canonical guidance file`, () => {
  const g = parseGuidance(fs.readFileSync(path.join(REPO_ROOT, MANIFEST_PATH), 'utf8'));
  assert.ok(g, `${MANIFEST_PATH} has no guidance: block`);
  assert.ok(g.canonical, 'guidance.canonical is empty');
  assert.ok(fs.existsSync(path.join(REPO_ROOT, g.canonical)), `${g.canonical} does not exist`);
});

check('the shipped guidance files satisfy every rule', () => {
  const g = parseGuidance(fs.readFileSync(path.join(REPO_ROOT, MANIFEST_PATH), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const f = runChecks(g, loadGuidanceFiles(REPO_ROOT, declaredPaths(g)), pkg.scripts ?? {});
  assert.deepEqual(f, [], `findings:\n${JSON.stringify(f, null, 2)}`);
});

console.log(`\n${passed} checks passed.`);
