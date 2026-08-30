#!/usr/bin/env node
// Fixtures for the guidance-manifest check. No deps — run with:
//   node scripts/docs/__tests__/check-guidance.test.mjs
//
// The failure this whole file guards against is quiet: three guidance documents
// that agree today, one canonical declaration in .ai/manifest.yaml that nobody
// re-reads, and six months later a tool loading the wrong one. The last cases
// run the checks against the REAL tree, which is what makes the manifest a
// contract rather than a comment.
//
// The verify block in the middle covers the drift that no per-file rule can see:
// rename the unit-test script in the canonical file, land the new name in
// package.json, and the projection goes on naming the old one with every other
// rule here green. That is agreement by discipline, and it is exactly the shape
// that stops holding the first time nobody is watching.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  MANIFEST_PATH,
  REPO_ROOT,
  commandsIn,
  declaredPaths,
  loadGuidanceFiles,
  parseGuidance,
  resolveIncludes,
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
    { canonical: '.claude/CLAUDE.md', projections: ['CLAUDE.md'], verify: ['lint'] },
    [
      file('.claude/CLAUDE.md', 'the rules — run `npm run lint`'),
      file('CLAUDE.md', '@AGENTS.md\nCanonical: .claude/CLAUDE.md\nVerify with `npm run lint`.\n'),
    ],
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

// --- the verify set: the only thing all three files must say identically -------
//
// Every rule above reads ONE file. That is why the drift below was silent: both
// files stay internally consistent through a rename, both pass every other rule,
// and they simply answer "how do I verify a change" differently.

const CANON = '.claude/CLAUDE.md';
// The projection always names the canonical path, so these cases isolate the
// verify rules instead of also tripping `projection-not-pointing`.
const verifyCase = (canonicalText, projectionText, verify = ['typecheck', 'lint']) =>
  runChecks(
    { canonical: CANON, projections: ['AGENTS.md'], verify },
    [file(CANON, canonicalText), file('AGENTS.md', `Full guide: ${CANON}\n${projectionText}`)],
    SCRIPTS,
  );

check('a manifest with no verify list cannot compare anything, and says so', () => {
  const f = runChecks({ canonical: CANON, projections: [] }, [file(CANON, 'x')], SCRIPTS);
  assert.ok(has(f, 'verify-undeclared'));
});

check('THE DRIFT: the canonical file renames a verify command and the projection does not', () => {
  // Both halves of the rename land in package.json, so `dangling-command` sees
  // nothing. The canonical file has moved on; AGENTS.md still names the old
  // command; the agent that opened AGENTS.md runs the wrong thing.
  const f = verifyCase(
    'Verify: `npm run typecheck`, `npm run lint`.',
    'Verify: `npm run typecheck`.', // never caught up on lint
  );
  const missing = f.filter((x) => x.rule === 'verify-command-missing');
  assert.equal(missing.length, 1);
  assert.match(missing[0].message, /AGENTS\.md/);
  assert.match(missing[0].message, /npm run lint/);
});

check('the CANONICAL file is held to the list too, not only the projections', () => {
  // Otherwise the manifest could declare a verify command the file it calls
  // canonical has never heard of, which is the same gap pointing the other way.
  const f = verifyCase('Verify: `npm run lint`.', 'Verify: `npm run typecheck`, `npm run lint`.');
  const missing = f.filter((x) => x.rule === 'verify-command-missing');
  assert.equal(missing.length, 1);
  assert.match(missing[0].message, /\.claude\/CLAUDE\.md/);
  assert.match(missing[0].message, /npm run typecheck/);
});

check('a verify command package.json has dropped is named before the files are blamed', () => {
  const f = verifyCase('run `npm run typecheck`', 'run `npm run typecheck`', ['typecheck', 'test:gone']);
  assert.ok(has(f, 'verify-command-dangling'));
  // `test:gone` does not exist, so "AGENTS.md does not name it" would be noise
  // on top of the real finding — the manifest is what has to change first.
  assert.equal(f.filter((x) => x.rule === 'verify-command-missing').length, 0);
});

check('files that agree on every verify command produce nothing', () => {
  assert.deepEqual(verifyCase('`npm run typecheck` then `npm run lint`', 'run `npm run lint` and `npm run typecheck`'), []);
});

check('an @include is expanded, so a projection may reach the command through one', () => {
  // The root CLAUDE.md is one line of prose and an `@AGENTS.md`. Reading its raw
  // bytes would report it as naming no command at all — true of the file, false
  // of what an agent sees.
  const f = runChecks(
    { canonical: CANON, projections: ['CLAUDE.md'], verify: ['lint'] },
    [
      file(CANON, 'run `npm run lint`'),
      { path: 'CLAUDE.md', text: `@AGENTS.md\n${CANON}\n`, expanded: `run \`npm run lint\`\n${CANON}\n` },
    ],
    SCRIPTS,
  );
  assert.deepEqual(f, []);
});

check('resolveIncludes pulls in a real file, ignores a missing one, and cannot loop', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kp-guidance-'));
  try {
    fs.writeFileSync(path.join(root, 'B.md'), 'run `npm run lint`\n');
    fs.writeFileSync(path.join(root, 'LOOP.md'), '@LOOP.md\ntail\n');
    assert.match(resolveIncludes('@B.md\n', root), /npm run lint/);
    assert.equal(resolveIncludes('@nope.md\n', root).trim(), '@nope.md', 'a missing include is left alone, never thrown on');
    assert.match(resolveIncludes('@LOOP.md\n', root), /tail/);
    assert.equal(resolveIncludes('mail@example.com\n', root).trim(), 'mail@example.com', 'only a whole line is an include');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- against the real tree ----------------------------------------------------

check(`${MANIFEST_PATH} declares a canonical guidance file`, () => {
  const g = parseGuidance(fs.readFileSync(path.join(REPO_ROOT, MANIFEST_PATH), 'utf8'));
  assert.ok(g, `${MANIFEST_PATH} has no guidance: block`);
  assert.ok(g.canonical, 'guidance.canonical is empty');
  assert.ok(fs.existsSync(path.join(REPO_ROOT, g.canonical)), `${g.canonical} does not exist`);
});

check(`${MANIFEST_PATH} declares the commands that verify a change`, () => {
  // Named separately from the sweep below because an empty list makes the whole
  // comparison vacuous: the rules would pass over three files nothing compared,
  // which is the state this check was added to leave.
  const g = parseGuidance(fs.readFileSync(path.join(REPO_ROOT, MANIFEST_PATH), 'utf8'));
  assert.ok(g.verify.length > 0, 'guidance.verify is empty — nothing holds the three files to the same commands');
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  for (const cmd of g.verify) assert.ok(cmd in pkg.scripts, `guidance.verify names \`npm run ${cmd}\`, which package.json does not define`);
});

check('every declared guidance file names every verify command — the drift this file exists for', () => {
  const g = parseGuidance(fs.readFileSync(path.join(REPO_ROOT, MANIFEST_PATH), 'utf8'));
  for (const f of loadGuidanceFiles(REPO_ROOT, declaredPaths(g))) {
    if (!declaredPaths(g).includes(f.path)) continue;
    const named = commandsIn(f.expanded ?? f.text);
    for (const cmd of g.verify) assert.ok(named.includes(cmd), `${f.path} does not tell an agent to run \`npm run ${cmd}\``);
  }
});

check('the shipped guidance files satisfy every rule', () => {
  const g = parseGuidance(fs.readFileSync(path.join(REPO_ROOT, MANIFEST_PATH), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const f = runChecks(g, loadGuidanceFiles(REPO_ROOT, declaredPaths(g)), pkg.scripts ?? {});
  assert.deepEqual(f, [], `findings:\n${JSON.stringify(f, null, 2)}`);
});

console.log(`\n${passed} checks passed.`);
