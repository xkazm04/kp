#!/usr/bin/env node
// Fixtures for the commit-subject gate. No deps — run with:
//   node scripts/release/__tests__/commit-msg.test.mjs
//
// The load-bearing case is the LAST block: every type this gate accepts must be
// a type prepare.mjs can file somewhere other than "Other". The whole point of
// the gate is that the changelog cut and the convention cannot drift apart, and
// that is the assertion which fails if they ever do.
import assert from 'node:assert/strict';
import { classify } from '../prepare.mjs';
import {
  KNOWN_TYPES,
  checkSubject,
  isExempt,
  parseArgs,
  review,
  subjectFromMessage,
} from '../commit-msg.mjs';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

const ok = (s) => assert.deepEqual(checkSubject(s), [], `expected "${s}" to conform`);
const bad = (s) => assert.ok(checkSubject(s).length > 0, `expected "${s}" to be rejected`);

// --- the shape ---------------------------------------------------------------
check('real subjects from this history conform', () => {
  ok('feat(app-master-bench): ideation nights, graded on the holder’s own ideas');
  ok('fix(app-master-bench): an unknown argument is an error, never a fallback');
  ok('chore(registry-map): regenerate - carried verdicts preserved');
  ok('docs: rewrite the self-hosting guide');
  ok('security(deps): next 16.3.3');
  ok('feat!: drop the legacy analyze endpoint');
  ok('refactor(shell)!: one tab registry');
});

check('a subject with no type prefix is rejected', () => {
  bad('fixed the token bug');
  bad('Update README');
  bad('WIP');
});

check('a type the release script cannot file is rejected', () => {
  bad('improvement(ui): nicer spacing');
  bad('Feat(ui): capitalised type');
  const problems = checkSubject('improvement(ui): nicer spacing');
  assert.match(problems[0], /unknown type "improvement"/);
  assert.match(problems[0], /Known types:/);
});

check('an empty scope is rejected, a missing scope is fine', () => {
  bad('feat(): nothing here');
  ok('feat: a scopeless change is normal');
});

check('a summary too short to read as a release-note line is rejected', () => {
  bad('fix: x');
});

check('an overlong subject is rejected, a long-but-reasonable one is not', () => {
  ok(`feat(scope): ${'x'.repeat(100)}`);
  bad(`feat(scope): ${'x'.repeat(140)}`);
});

// --- what the gate must NOT reject ------------------------------------------
check('git’s own subjects are exempt', () => {
  assert.ok(isExempt('Merge branch \'main\' into feature'));
  assert.ok(isExempt('Revert "feat(x): a thing"'));
  assert.ok(isExempt('fixup! feat(x): a thing'));
  ok('Merge pull request #12 from someone/branch');
  ok('Revert "feat(x): a thing"');
});

check('the dependabot prefix this repo configures is accepted', () => {
  // .github/dependabot.yml: prefix "deps" / "deps(dev)" / "deps(edge)" / "deps(python)".
  ok('deps(deps): bump next from 16.3.0 to 16.3.3');
  ok('deps(python): bump pydantic from 2.12.5 to 2.13.0');
  ok('ci(actions): bump actions/checkout');
});

// --- the waiver --------------------------------------------------------------
check('a Commit-convention-exemption trailer waives, on the record', () => {
  const verdict = review([
    { subject: 'imported vendor snapshot', body: 'Commit-convention-exemption: verbatim upstream import' },
  ]);
  assert.equal(verdict.ok, true);
  assert.match(verdict.report, /waived/);
  assert.match(verdict.report, /verbatim upstream import/);
});

check('a waiver on a conforming subject is not announced as one', () => {
  const verdict = review([{ subject: 'fix(auth): stop the leak', body: 'Commit-convention-exemption: unnecessary' }]);
  assert.equal(verdict.ok, true);
  assert.ok(!verdict.report.includes('waived'));
});

check('one bad subject fails the whole range and names it', () => {
  const verdict = review([
    { subject: 'feat(a): fine', body: '' },
    { subject: 'oops', body: '' },
  ]);
  assert.equal(verdict.ok, false);
  assert.match(verdict.report, /1 of 2/);
  assert.match(verdict.report, /"oops"/);
  assert.match(verdict.report, /git commit --amend/);
});

// --- plumbing ----------------------------------------------------------------
check('the subject is the first non-comment line of a message file', () => {
  assert.equal(
    subjectFromMessage('\n# please enter the commit message\nfeat(x): a thing\n\nbody text\n'),
    'feat(x): a thing',
  );
  assert.equal(subjectFromMessage('# only comments\n'), '');
});

check('cli args parse', () => {
  assert.deepEqual(parseArgs(['--base', 'origin/main', '--head', 'HEAD']), {
    file: null,
    subject: null,
    base: 'origin/main',
    head: 'HEAD',
  });
  assert.equal(parseArgs(['--file', '.git/COMMIT_EDITMSG']).file, '.git/COMMIT_EDITMSG');
});

// --- the coupling this gate exists to protect --------------------------------
check('every accepted type is a type the changelog cut can file', () => {
  assert.ok(KNOWN_TYPES.length >= 8, 'the vocabulary should not have collapsed');
  for (const type of KNOWN_TYPES) {
    const { section } = classify(`${type}(scope): a change`);
    assert.notEqual(
      section,
      'Other',
      `type "${type}" passes the gate but prepare.mjs files it under "Other" — the two have drifted`,
    );
  }
});

check('a subject the gate rejects is exactly one the changelog cut would lose', () => {
  assert.equal(classify('fixed the token bug').section, 'Other');
  assert.equal(classify('improvement(ui): nicer spacing').section, 'Other');
});

console.log(`\ncommit-msg fixtures: ${passed} checks passed.`);
