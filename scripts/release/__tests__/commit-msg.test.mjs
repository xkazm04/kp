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
  checkShape,
  checkSubject,
  checkTypeAgainstFiles,
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

// --- the shape: one clause about the change ----------------------------------
//
// These four are real subjects from this repository's log. Every one of them
// passed the gate before checkShape existed, which is the gap it closes.
check('the session-report subjects in this history are rejected', () => {
  bad('fix: Done. Here\'s what I found and did');
  bad('fix: All four items are settled. Here\'s what I found and did');
  bad('fix: Done. Three of the four were already answered in-tree; one was');
  bad('fix: Done, here is the summary of the work');
});

check('a subject holding two sentences is rejected, and says where the rest goes', () => {
  const problems = checkSubject('fix(auth): stop the leak. It was in the session cookie');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /more than one sentence/);
  assert.match(problems[0], /body/);
  // A dotted version or a decimal is not a sentence boundary.
  ok('deps(deps): bump next from 16.3.0 to 16.3.3');
  ok('fix(db): honour KP_DB_PATH in app/_lib/db.ts');
});

check('a subject truncated mid-clause is rejected', () => {
  bad('fix(schedule): the slot is dropped when the candidate and');
  bad('feat(ui): a panel that opens when the operator is');
  // The rule is a tail-word rule, not a parser: a line cut on a noun still
  // reads as a clause and passes. It catches the cut that leaves a dangling
  // word, which is the shape a sliced agent message actually produces.
  ok('feat(ui): a panel that opens for the operator');
  bad('fix: reconcile the queue against the');
  bad('chore: regenerate the map because it was');
  assert.match(checkShape('the slot is dropped when the candidate and')[0], /stops on "and"/);
});

check('a subject cut on punctuation or an unclosed delimiter is rejected', () => {
  bad('fix(comms): retry the outbox,');
  bad('feat(api): add the endpoint (behind a flag');
  bad('fix(db): stop the write in `pipeline');
  bad('docs: rewrite the guide...');
});

check('a first-person or narrative subject is rejected', () => {
  bad('fix(auth): I moved the token check into the middleware');
  bad('feat(ui): here is the new empty state');
  bad('chore: successfully regenerated the context map');
  bad('fix(db): this change repairs the pipeline writer');
  // …and the honest ones are not.
  ok('fix(i18n): add the missing cs plural forms');
  ok('feat(schedule): honour the candidate timezone');
});

check('a subject that ends in a full stop is rejected', () => {
  bad('fix(auth): stop the leak.');
  ok('fix(auth): stop the leak');
});

check('descriptive subjects in this repository’s own voice still pass', () => {
  ok('feat(app-master-bench): ideation nights, graded on the holder’s own ideas');
  ok('fix(app-master-bench): an unknown argument is an error, never a fallback');
  ok('chore(registry-map): regenerate - carried verdicts preserved');
  ok('perf(routes): import the slice, not the barrel, in the health handler');
  ok('security(deps): next 16.3.3');
});

// --- the type against the diff ------------------------------------------------
check('a documentation-only commit may not be typed feat or fix', () => {
  const problems = checkTypeAgainstFiles('feat(docs): explain self-hosting', ['docs/features/comms/README.md']);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /every file in this commit is documentation/);
  assert.deepEqual(checkTypeAgainstFiles('docs: explain self-hosting', ['docs/x.md', 'README.md']), []);
  assert.deepEqual(checkTypeAgainstFiles('chore: prune the archive', ['docs/_archive/old.md']), []);
});

check('a test-only commit may not be typed feat or fix', () => {
  assert.match(
    checkTypeAgainstFiles('fix(db): cover the transaction path', ['app/_lib/db/pipeline.test.ts'])[0],
    /every file in this commit is a test/,
  );
  assert.deepEqual(checkTypeAgainstFiles('test(db): cover the transaction path', ['app/_lib/db/pipeline.test.ts']), []);
  assert.deepEqual(checkTypeAgainstFiles('ci: pin the e2e shard', ['e2e/journey-role-to-schedule.spec.ts']), []);
});

check('a mixed commit is never judged on its type', () => {
  assert.deepEqual(
    checkTypeAgainstFiles('fix(comms): stop the double send', ['app/_lib/comms.ts', 'docs/features/comms/README.md']),
    [],
  );
  // No file list (a subject checked in isolation) means the rule does not run.
  assert.deepEqual(checkTypeAgainstFiles('fix: something', []), []);
  assert.deepEqual(checkTypeAgainstFiles('not conventional at all', ['docs/x.md']), []);
});

check('review() applies the type rule only when it was given the files', () => {
  assert.equal(review([{ subject: 'feat: explain the thing', body: '', files: ['docs/x.md'] }]).ok, false);
  assert.equal(review([{ subject: 'feat: explain the thing', body: '' }]).ok, true);
  // The waiver covers the type rule too — it is one verdict per commit.
  assert.equal(
    review([{ subject: 'feat: explain the thing', body: 'Commit-convention-exemption: doc for an unshipped feature', files: ['docs/x.md'] }]).ok,
    true,
  );
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
