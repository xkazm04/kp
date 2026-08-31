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
  CI_WORKFLOW,
  MANIFEST_PATH,
  REPO_ROOT,
  ciCommands,
  commandsIn,
  declaredPaths,
  loadCiCommands,
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

// --- the gates: what CI will actually run --------------------------------------
//
// `verify` above is a consistency rule — it holds the three files to the same
// three commands. It says nothing about whether those commands are the ones that
// decide the build, and that is the drift these cases cover: ci.yml grew to two
// dozen steps while every guidance file went on naming three, and every rule
// above stayed green because each of them reads guidance against guidance.

check('only `run:` steps are read — a command NAMED IN A COMMENT is not a gate', () => {
  // ci.yml's comments name half a dozen scripts it deliberately does not run
  // (`test:e2e`, `bench:gate`, `ci:budget -- --tighten`). A grep for `npm run`
  // would seed the gate list with fiction.
  const yaml = [
    'jobs:',
    '  q:',
    '    steps:',
    '      # Deliberately NOT gated: npm run test:e2e (needs live keys).',
    '      - run: npm run lint',
    '      - name: block scalar',
    '        run: |',
    '          # npm run commented:out',
    '          npm run typecheck',
    '          npm ci',
    '        env:',
    '          FOO: npm run not:a:step',
    '      - run: >-',
    '          npx playwright test',
    '          modal-escape',
  ].join('\n');
  assert.deepEqual(ciCommands(yaml), ['lint', 'typecheck']);
});

check('a block scalar ends at its sibling key, not at the next step', () => {
  // The `env:` above sits at the same column as `run:`, which is what bounds the
  // block. Getting this wrong makes every `${{ }}` value part of the script.
  const yaml = ['      - name: x', '        run: |', '          npm run a', '        env:', '          K: v', '      - run: npm run b'].join('\n');
  assert.deepEqual(ciCommands(yaml), ['a', 'b']);
});

const CI = ['lint', 'typecheck'];
const gateCase = (guidance, files, scripts = SCRIPTS) => runChecks(guidance, files, scripts, CI);
// `verify` is populated and named by both files so these cases isolate the gate
// rules instead of also tripping the verify ones.
const GATE_BASE = { canonical: CANON, projections: ['AGENTS.md'], verify: ['lint'] };
const gateFiles = (agentsText) => [
  file(CANON, 'the rules — run `npm run lint`'),
  file('AGENTS.md', `Full guide: ${CANON}\nrun \`npm run lint\`\n${agentsText}`),
];

check('the gate rules DO NOT RUN when the caller supplied no workflow', () => {
  // Three-argument callers get exactly the behaviour they had. A check that
  // invents its own evidence is worse than one that says it did not run.
  const f = runChecks(GATE_BASE, gateFiles(''), SCRIPTS);
  assert.equal(f.filter((x) => x.rule.startsWith('gate')).length, 0);
});

check('a manifest with no gates list, and none naming the doc that carries it', () => {
  const f = gateCase(GATE_BASE, gateFiles(''));
  assert.ok(has(f, 'gates-undeclared'));
  assert.ok(has(f, 'gates-doc-missing'));
});

check('THE DRIFT: a step added to ci.yml that no guidance names', () => {
  const f = gateCase(
    { ...GATE_BASE, gatesDoc: 'AGENTS.md', gates: ['lint'] },
    gateFiles('Gates: `npm run lint`.'),
  );
  const unlisted = f.filter((x) => x.rule === 'gate-unlisted');
  assert.equal(unlisted.length, 1);
  assert.match(unlisted[0].message, /npm run typecheck/);
  assert.match(unlisted[0].message, new RegExp(CI_WORKFLOW.replace(/[./]/g, '\\$&')));
});

check('a declared gate CI no longer runs is stale, and says so', () => {
  // `test:python` exists in package.json — that is what makes this the stale
  // case rather than the dangling one: the script is fine, the step is gone.
  const f = gateCase(
    { ...GATE_BASE, gatesDoc: 'AGENTS.md', gates: ['lint', 'typecheck', 'test:python'] },
    gateFiles('Gates: `npm run lint`, `npm run typecheck`, `npm run test:python`.'),
    { ...SCRIPTS, 'test:python': 'python -m unittest' },
  );
  const stale = f.filter((x) => x.rule === 'gate-stale');
  assert.equal(stale.length, 1);
  assert.match(stale[0].message, /npm run test:python/);
});

check('a declared gate the gates doc never names is a finding', () => {
  const f = gateCase(
    { ...GATE_BASE, gatesDoc: 'AGENTS.md', gates: ['lint', 'typecheck'] },
    gateFiles('Gates: `npm run lint`.'),
  );
  const undocumented = f.filter((x) => x.rule === 'gate-undocumented');
  assert.equal(undocumented.length, 1);
  assert.match(undocumented[0].message, /npm run typecheck/);
});

check('a gate package.json dropped is named before the doc is blamed for it', () => {
  const f = gateCase(
    { ...GATE_BASE, gatesDoc: 'AGENTS.md', gates: ['lint', 'typecheck', 'gone:check'] },
    gateFiles('Gates: `npm run lint`, `npm run typecheck`.'),
  );
  assert.ok(has(f, 'gate-command-dangling'));
  assert.equal(f.filter((x) => x.rule === 'gate-undocumented').length, 0, 'the manifest is what has to change first');
});

check('the gates doc must be guidance the manifest already declares', () => {
  // Otherwise the table could live in a file no reader of the guidance opens,
  // which passes the rule and closes nothing.
  const f = gateCase(
    { ...GATE_BASE, gatesDoc: 'docs/somewhere.md', gates: ['lint', 'typecheck'] },
    gateFiles('Gates: `npm run lint`, `npm run typecheck`.'),
  );
  assert.ok(has(f, 'gates-doc-missing'));
});

check('a manifest whose gates match CI and are all named by the gates doc produces nothing', () => {
  assert.deepEqual(
    gateCase(
      { ...GATE_BASE, gatesDoc: 'AGENTS.md', gates: ['lint', 'typecheck'] },
      gateFiles('Gates: `npm run lint`, `npm run typecheck`.'),
    ),
    [],
  );
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

check(`${MANIFEST_PATH} declares exactly the gates ${CI_WORKFLOW} runs`, () => {
  // The assertion that makes "the documented commands are the gating commands"
  // a fact rather than a claim. Stated as set equality on purpose: either
  // direction of drift is a failure, and naming both here means the message says
  // which one happened before anyone opens the workflow.
  const g = parseGuidance(fs.readFileSync(path.join(REPO_ROOT, MANIFEST_PATH), 'utf8'));
  const ci = loadCiCommands(REPO_ROOT);
  assert.ok(ci.length > 0, `${CI_WORKFLOW} runs no npm scripts — the reader, not the workflow, is what changed`);
  assert.deepEqual(
    [...g.gates].sort(),
    ci,
    'guidance.gates and the workflow disagree; the extra entries are on whichever side is longer',
  );
});

check('every gate is a real npm script, and the declared gates doc names all of them', () => {
  const g = parseGuidance(fs.readFileSync(path.join(REPO_ROOT, MANIFEST_PATH), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.ok(g.gatesDoc, 'guidance.gates_doc is unset — nothing has to carry the table');
  const doc = loadGuidanceFiles(REPO_ROOT, declaredPaths(g)).find((f) => f.path === g.gatesDoc);
  assert.ok(doc, `${g.gatesDoc} does not exist`);
  const named = commandsIn(doc.expanded ?? doc.text);
  for (const cmd of g.gates) {
    assert.ok(cmd in pkg.scripts, `guidance.gates names \`npm run ${cmd}\`, which package.json does not define`);
    assert.ok(named.includes(cmd), `${g.gatesDoc} does not tell an agent that \`npm run ${cmd}\` gates its push`);
  }
});

check('the shipped guidance files satisfy every rule', () => {
  const g = parseGuidance(fs.readFileSync(path.join(REPO_ROOT, MANIFEST_PATH), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const f = runChecks(g, loadGuidanceFiles(REPO_ROOT, declaredPaths(g)), pkg.scripts ?? {}, loadCiCommands(REPO_ROOT));
  assert.deepEqual(f, [], `findings:\n${JSON.stringify(f, null, 2)}`);
});

console.log(`\n${passed} checks passed.`);
