#!/usr/bin/env node
// Fixtures for the workflow security gate. No deps — run with:
//   node scripts/security/__tests__/check-actions.test.mjs
//
// One firing fixture per rule class the gate can report, plus the clean case for
// each, plus the real `.github/workflows` tree — because a rule that fires on a
// fixture and is pointed at nothing is the failure mode this whole file exists
// to prevent. The rule classes, in the order the checker emits them:
//
//   no-permissions          a workflow that does not scope GITHUB_TOKEN at all
//   run-injection           `${{ … }}` substituted into a shell script
//   script-injection        …into an `actions/github-script` body
//   persisted-credentials   a checkout handed a PAT and told to leave it on disk
//   untrusted-checkout      a privileged trigger checking out an event-derived ref
//   unpinned / unpinned-known  an action on a mutable tag, outside / inside the allowlist
//   stale-allowlist         an allowlist entry no workflow uses any more
//
// These cases lived in scripts/review/__tests__/gate-check.test.mjs until wave 24,
// which meant `npm run test:security` — the script whose name says it covers the
// security gates — ran only the secret scanner, and the largest gate in the
// repository had no test row of its own in the AGENTS.md gate table. Moving them
// here is the point: the gate and its fixtures now travel together.
//
// The workflow READER these cases exercise is shared with scripts/review/gate-check.mjs
// and pinned separately in scripts/review/__tests__/workflow-yaml.test.mjs.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ALLOWLIST_PATH,
  DANGEROUS_TRIGGERS,
  PIN_ALLOWLIST,
  checkoutRefs,
  checkoutSteps,
  hasTopLevelPermissions,
  isPinned,
  isTrustedInRun,
  jobPermissions,
  loadAllowlist,
  persistedCredentials,
  rewriteUses,
  runChecks as runActionChecks,
  runScriptLines,
  triggersIn,
  untrustedCheckoutRefs,
  untrustedRunRefs,
  untrustedScriptRefs,
  usesIn,
} from '../check-actions.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

const has = (findings, rule) => findings.some((f) => f.rule === rule);
const blocking = (findings) => findings.filter((f) => f.severity === 'blocking');

// --- action pinning + token scope --------------------------------------------

check('only a full commit SHA counts as pinned', () => {
  assert.equal(isPinned('actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5'), true);
  assert.equal(isPinned('actions/checkout@v4'), false);
  assert.equal(isPinned('actions/checkout@main'), false);
  assert.equal(isPinned('./.github/actions/local'), true);
  assert.equal(isPinned('docker://alpine:3.20'), false);
  assert.equal(isPinned(`docker://alpine@sha256:${'a'.repeat(64)}`), true);
});

check('every uses: in a file is found, comments excluded', () => {
  const found = usesIn('jobs:\n  a:\n    steps:\n      - uses: x/y@v1\n      # - uses: dead/one@v1\n      - uses: p/q@v2\n');
  assert.deepEqual(found.map((u) => u.uses), ['x/y@v1', 'p/q@v2']);
});

check('a NEW unpinned action is blocking; an allowlisted one is a note', () => {
  const text = 'permissions:\n  contents: read\njobs:\n  a:\n    steps:\n      - uses: brand/new@v9\n      - uses: known/old@v1\n';
  const list = [{ uses: 'known/old', ref: 'v1', why: 'documented debt' }];
  const f = runActionChecks([{ file: 'w.yml', text }], list);
  assert.ok(has(f, 'unpinned'));
  assert.ok(has(f, 'unpinned-known'));
  assert.equal(blocking(f).length, 1);
});

check('an allowlist entry nothing uses any more is blocking rot', () => {
  const text = 'permissions:\n  contents: read\njobs:\n  a:\n    steps:\n      - run: echo\n';
  const f = runActionChecks([{ file: 'w.yml', text }], [{ uses: 'gone/away', ref: 'v1', why: 'x' }]);
  assert.ok(has(f, 'stale-allowlist'));
});

check('a top-level permissions block is required; job-level does not substitute', () => {
  assert.equal(hasTopLevelPermissions('permissions:\n  contents: read\n'), true);
  assert.equal(hasTopLevelPermissions('jobs:\n  a:\n    permissions:\n      contents: read\n'), false);
  const f = runActionChecks([{ file: 'w.yml', text: 'jobs:\n  a:\n    permissions:\n      contents: read\n' }], []);
  assert.ok(has(f, 'no-permissions'));
});

check('an allowlist that cannot be read excuses NOTHING', () => {
  // The direction matters: a missing file must not read as "everything is
  // allowed to float". pin-actions.yml rewrites this file unattended, so the
  // failure mode of a bad write has to be a red build, not a silent amnesty.
  assert.deepEqual(loadAllowlist(path.join(REPO_ROOT, 'no', 'such', 'root')), []);
});

check('the committed allowlist is the one the checks actually use', () => {
  const onDisk = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ALLOWLIST_PATH), 'utf8'));
  assert.deepEqual(PIN_ALLOWLIST, onDisk.allow);
  for (const e of PIN_ALLOWLIST) {
    assert.ok(e.uses && e.ref && e.why, `every entry states why it still floats: ${JSON.stringify(e)}`);
  }
});

check('--resolve rewrites a tag to a SHA and keeps the tag as the comment', () => {
  const out = rewriteUses('      - uses: a/b@v3\n', 'a/b@v3', 'f'.repeat(40), 'v3.1.0');
  assert.equal(out.trim(), `- uses: a/b@${'f'.repeat(40)} # v3.1.0`);
  assert.ok(out.startsWith('      - '), 'indentation is preserved');
});

// --- nothing an outsider writes reaches a shell ------------------------------
//
// The dispatch workflow turns an issue title into an agent run, and the release
// workflow signs and publishes an image. A `${{ }}` in a `run:` line is the one
// step between those two facts, because Actions substitutes the expression into
// the script text before bash exists to quote anything.

check('both `run:` forms are read: the inline scalar and the block', () => {
  const text = [
    'jobs:',
    '  a:',
    '    steps:',
    '      - run: echo inline',
    '      - name: block',
    '        run: |',
    '          line one',
    '',
    '          line two',
    '        env:',
    '          NOT_SCRIPT: ${{ github.event.issue.title }}',
    '      - run: >-',
    '          folded one',
  ].join('\n');
  const lines = runScriptLines(text).map((l) => l.text.trim());
  assert.deepEqual(lines, ['echo inline', 'line one', 'line two', 'folded one']);
});

check('an `env:` block after a `run:` is never mistaken for script', () => {
  // The whole point of the fix is that the value moves into `env:`. If the
  // reader counted those lines as script, the fix would report as the bug and
  // nobody would be able to make this check pass honestly.
  const text = 'jobs:\n  a:\n    steps:\n      - run: node x.mjs\n        env:\n          T: ${{ github.event.issue.title }}\n';
  assert.deepEqual(untrustedRunRefs(text), []);
});

check('an issue title interpolated into a run line is blocking', () => {
  const text = 'permissions:\n  contents: read\njobs:\n  a:\n    steps:\n      - run: echo "${{ github.event.issue.title }}"\n';
  const f = runActionChecks([{ file: 'w.yml', text }], []);
  assert.ok(has(f, 'run-injection'));
  assert.equal(blocking(f).length, 1);
  assert.match(f.find((x) => x.rule === 'run-injection').message, /github\.event\.issue\.title/);
});

check('a context inside format() is found, not hidden by the function call', () => {
  const text = "jobs:\n  a:\n    steps:\n      - run: |\n          B=\"${{ github.event_name == 'pull_request' && format('origin/{0}', github.event.pull_request.base.ref) || 'HEAD~1' }}\"\n";
  const refs = untrustedRunRefs(text).map((r) => r.ref);
  assert.deepEqual(refs, ['github.event.pull_request.base.ref']);
});

check('a step output is untrusted too — it is only as trusted as what wrote it', () => {
  const refs = untrustedRunRefs('jobs:\n  a:\n    steps:\n      - run: exit "${{ steps.review.outputs.status }}"\n').map((r) => r.ref);
  assert.deepEqual(refs, ['steps.review.outputs.status']);
  assert.deepEqual(untrustedRunRefs('jobs:\n  a:\n    steps:\n      - run: echo ${{ needs.publish.outputs.digest }}\n').map((r) => r.ref), [
    'needs.publish.outputs.digest',
  ]);
});

check('the fixed-shape, repo-controlled contexts stay usable', () => {
  assert.equal(isTrustedInRun('github.repository'), true);
  assert.equal(isTrustedInRun('github.sha'), true);
  assert.equal(isTrustedInRun('github.event_name'), true);
  assert.equal(isTrustedInRun('runner.temp'), true);
  assert.equal(isTrustedInRun('matrix.language'), true);
  // Event payload is never on the list, including the parts that look harmless.
  assert.equal(isTrustedInRun('github.event.repository.default_branch'), false);
  assert.equal(isTrustedInRun('github.event.pull_request.number'), false);
  assert.equal(isTrustedInRun('github.head_ref'), false);
  assert.equal(isTrustedInRun('env.SOMETHING'), false);
  assert.equal(isTrustedInRun('secrets.ANTHROPIC_API_KEY'), false);
});

check('no workflow in this tree substitutes an expression into a shell', () => {
  const dir = path.join(REPO_ROOT, '.github/workflows');
  for (const file of fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
    const refs = untrustedRunRefs(fs.readFileSync(path.join(dir, file), 'utf8'));
    assert.deepEqual(refs, [], `${file} interpolates ${JSON.stringify(refs)} into a run: script`);
  }
});

// --- …and how much it would reach if it did -----------------------------------
//
// `run-injection` asks whether hostile text can become CODE. It says nothing
// about what that code would then HOLD. The two workflows that take outside
// content and act on it are the two worth answering that second question for,
// and the answer is a line in a YAML file that widens by accident.

check('a job-level permissions block is read as a scope map', () => {
  const text = [
    'jobs:',
    '  a:',
    '    runs-on: ubuntu-latest',
    '    permissions:',
    '      contents: read',
    '      pull-requests: write # a trailing comment is not a level',
    '    steps:',
    '      - uses: x/y@v1',
    '        with:',
    '          permissions: 0644', // a step input, not the job's scope
    '  b:',
    '    runs-on: ubuntu-latest',
    '  c:',
    '    permissions: read-all',
    '  d:',
    '    permissions: {}',
    '  e:',
    '    permissions: # a comment here does not make this an inline value',
    '      actions: read',
  ].join('\n');
  assert.deepEqual(jobPermissions(text), {
    a: { contents: 'read', 'pull-requests': 'write' },
    b: null, // declares none — inherits the workflow's
    c: 'read-all',
    d: {},
    e: { actions: 'read' },
  });
});

check('the reader stops at the end of `jobs:`', () => {
  assert.deepEqual(jobPermissions('jobs:\n  a:\n    permissions:\n      contents: read\nconcurrency:\n  group: g\n'), {
    a: { contents: 'read' },
  });
});

// THE CONTRACT. Both entries below are workflows whose input is written by
// somebody else — an issue body, a pull request branch — and that hold a token
// which can write. Each scope here is the smallest set under which the job
// still does its work; the reasoning for each is in the workflow file itself.
//
// This is a pin, not a policy: it does not say a scope may never be added. It
// says adding one cannot happen in a diff nobody read. If a step genuinely
// needs more, widen the line AND this map in the same change, and say why in
// the workflow's comment.
const UNTRUSTED_INPUT_SCOPES = {
  'agent-dispatch.yml': {
    // The draft PR is opened with AGENT_PR_TOKEN, so `pull-requests: write` is
    // deliberately absent from the default token.
    propose: { contents: 'write', issues: 'write' },
  },
  'autofix.yml': {
    // The commit is pushed with AUTOFIX_TOKEN, so the default token only reads.
    autofix: { contents: 'read', 'pull-requests': 'write' },
  },
};

check('the workflows that handle untrusted content hold the smallest scope that works', () => {
  for (const [file, expected] of Object.entries(UNTRUSTED_INPUT_SCOPES)) {
    const text = fs.readFileSync(path.join(REPO_ROOT, '.github/workflows', file), 'utf8');
    const actual = jobPermissions(text);
    for (const [jobId, scopes] of Object.entries(expected)) {
      assert.deepEqual(
        actual[jobId],
        scopes,
        `${file}: job \`${jobId}\` no longer holds the scope this fixture pins. It takes content ` +
          'an outsider wrote; widening its token is a decision, so make it here too.',
      );
    }
  }
});

check('every workflow keeps its top-level default at contents: read', () => {
  // The floor the job-level blocks are widenings OF. A workflow whose top-level
  // default is write hands that scope to every job that forgot to scope itself.
  const dir = path.join(REPO_ROOT, '.github/workflows');
  for (const file of fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
    // Split rather than regex over the raw text: every reader in check-actions.mjs
    // is `\r?\n`-tolerant, and a fixture that goes red only on a Windows checkout
    // is a fixture people learn to skip.
    const lines = fs.readFileSync(path.join(dir, file), 'utf8').split(/\r?\n/);
    const at = lines.findIndex((l) => /^permissions:[ \t]*$/.test(l));
    assert.notEqual(at, -1, `${file} has no top-level permissions block`);
    const scopes = [];
    for (let j = at + 1; j < lines.length && /^[ \t]+\S/.test(lines[j]); j++) scopes.push(lines[j].trim());
    assert.deepEqual(scopes, ['contents: read'], `${file}: top-level default is not the read-only floor`);
  }
});

// --- the two sinks that reach code without passing through `run:` ---------------

check('an expression in a github-script body is blocking — a different interpreter, the same bug', () => {
  const text = [
    'permissions:',
    '  contents: read',
    'jobs:',
    '  a:',
    '    steps:',
    '      - uses: actions/github-script@60a0d83039c74a4aee543508d2ffcb1c3799cdea',
    '        with:',
    '          script: |',
    '            core.info("${{ github.event.issue.body }}")',
  ].join('\n');
  const f = runActionChecks([{ file: 'w.yml', text }], []);
  assert.ok(has(f, 'script-injection'));
  assert.match(f.find((x) => x.rule === 'script-injection').message, /github\.event\.issue\.body/);
});

check('`script:` is only read as code when github-script is the thing reading it', () => {
  // Other actions take a `script:` string input that never reaches an
  // interpreter. Flagging those would train people to ignore the rule.
  const text = 'jobs:\n  a:\n    steps:\n      - uses: some/other@v1\n        with:\n          script: ${{ github.event.issue.title }}\n';
  assert.deepEqual(untrustedScriptRefs(text), []);
});

check('the top-level `on:` keys are read, in all three spellings', () => {
  assert.deepEqual(triggersIn('on: push\n'), ['push']);
  assert.deepEqual(triggersIn('on: [push, pull_request]\n'), ['push', 'pull_request']);
  // Block form: a trigger's own filters are indented deeper and are not triggers.
  assert.deepEqual(triggersIn('name: X\non:\n  push:\n    branches:\n      - main\n  pull_request_target:\n    types: [opened]\njobs:\n  a:\n'), [
    'push',
    'pull_request_target',
  ]);
});

check('a checkout `ref:` is attributed to the checkout step, not to whatever follows it', () => {
  const text = [
    'jobs:',
    '  a:',
    '    steps:',
    '      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5',
    '        with:',
    '          ref: ${{ github.event.pull_request.head.sha }}',
    '      - uses: other/action@v1',
    '        with:',
    '          ref: not-a-checkout',
  ].join('\n');
  assert.deepEqual(checkoutRefs(text).map((r) => r.value), ['${{ github.event.pull_request.head.sha }}']);
});

check('pull_request_target checking out the PR head is blocking', () => {
  // The one that hands a fork the base repository's secrets: these triggers run
  // with the full token, and `npm ci` on a stranger's tree is all it takes.
  const text = [
    'permissions:',
    '  contents: read',
    'on:',
    '  pull_request_target:',
    'jobs:',
    '  a:',
    '    steps:',
    '      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5',
    '        with:',
    '          ref: ${{ github.event.pull_request.head.sha }}',
    '      - run: npm ci',
  ].join('\n');
  const f = runActionChecks([{ file: 'w.yml', text }], []);
  assert.ok(has(f, 'untrusted-checkout'));
  assert.equal(blocking(f).length, 1, 'the checkout is the finding — the run: line is clean');
});

check('the same checkout on `pull_request` is fine, and so is the default one', () => {
  const head = '      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5\n        with:\n          ref: ${{ github.event.pull_request.head.sha }}\n';
  assert.deepEqual(untrustedCheckoutRefs(`on:\n  pull_request:\njobs:\n  a:\n    steps:\n${head}`), []);
  // On pull_request_target the DEFAULT ref is the base branch, which is the
  // whole reason the trigger is usable at all.
  assert.deepEqual(
    untrustedCheckoutRefs('on:\n  pull_request_target:\njobs:\n  a:\n    steps:\n      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5\n'),
    [],
  );
  // …and a repo-controlled ref stays usable: on this trigger `github.sha` IS base.
  assert.deepEqual(
    untrustedCheckoutRefs(`on:\n  workflow_run:\njobs:\n  a:\n    steps:\n      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5\n        with:\n          ref: \${{ github.sha }}\n`),
    [],
  );
});

check('no workflow in this tree pairs a privileged trigger with an event-derived checkout', () => {
  const dir = path.join(REPO_ROOT, '.github/workflows');
  for (const file of fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    assert.deepEqual(untrustedScriptRefs(text), [], `${file} interpolates into a github-script body`);
    const bad = untrustedCheckoutRefs(text);
    assert.deepEqual(bad, [], `${file} checks out ${JSON.stringify(bad)} under ${triggersIn(text).filter((t) => DANGEROUS_TRIGGERS.includes(t))}`);
  }
});

// --- the credential the checkout LEAVES BEHIND --------------------------------
//
// The third sink, and the one that executes nothing: `actions/checkout` writes
// its `token:` into `.git/config` and leaves it there. For the default token that
// is a wash. For a PAT it is not — the PAT exists because it outranks the default
// token, no `permissions:` line bounds it, and the jobs that need one are exactly
// the jobs that check out somebody's branch and `npm ci` over it.

check('the `with:` inputs of a checkout step are read, and only that step\'s', () => {
  const text = [
    'jobs:',
    '  a:',
    '    steps:',
    '      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5',
    '        with:',
    '          ref: main',
    '          token: ${{ secrets.PAT }}',
    '        env:',
    '          token: not-the-action-input', // a sibling key of `with:`, not an input
    '      - uses: other/action@34e114876b0b11c390a56381ad16ebd13914f8d5',
    '        with:',
    '          token: ${{ secrets.OTHER }}',
  ].join('\n');
  const steps = checkoutSteps(text);
  assert.equal(steps.length, 1, 'only the checkout step is a checkout step');
  assert.equal(steps[0].inputs.ref.value, 'main');
  assert.equal(steps[0].inputs.token.value, '${{ secrets.PAT }}');
  assert.equal(steps[0].inputs.token.line, 7, 'the finding points at the token line, not the step');
});

check('a checkout handed a PAT and left persisted is blocking', () => {
  const text = [
    'permissions:',
    '  contents: read',
    'jobs:',
    '  a:',
    '    steps:',
    '      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5',
    '        with:',
    '          token: ${{ secrets.AUTOFIX_TOKEN }}',
    '      - run: npm ci',
  ].join('\n');
  const f = runActionChecks([{ file: 'w.yml', text }], []);
  assert.ok(has(f, 'persisted-credentials'));
  assert.equal(blocking(f).length, 1, 'the checkout is the finding — the run: line is clean');
  assert.match(f.find((x) => x.rule === 'persisted-credentials').fix, /persist-credentials: false/);
});

check('the default token is not a PAT, and `persist-credentials: false` clears a PAT', () => {
  const step = (...withLines) =>
    [
      'jobs:',
      '  a:',
      '    steps:',
      '      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5',
      '        with:',
      ...withLines.map((l) => `          ${l}`),
    ].join('\n');
  // The default token is already in the job's env and is bounded by
  // `permissions:` — persisting it adds no reach the reviewer cannot see.
  assert.deepEqual(persistedCredentials(step('token: ${{ secrets.GITHUB_TOKEN }}')), []);
  assert.deepEqual(persistedCredentials(step('token: ${{ github.token }}')), []);
  // No `token:` at all is the same case: checkout falls back to the default.
  assert.deepEqual(persistedCredentials(step('ref: main')), []);
  // A PAT, opted out of persistence, in either order.
  assert.deepEqual(persistedCredentials(step('token: ${{ secrets.PAT }}', 'persist-credentials: false')), []);
  assert.deepEqual(persistedCredentials(step('persist-credentials: false', 'token: ${{ secrets.PAT }}')), []);
  // …and the one that is not fine.
  assert.deepEqual(
    persistedCredentials(step('token: ${{ secrets.PAT }}', 'persist-credentials: true')).map((c) => c.token),
    ['${{ secrets.PAT }}'],
  );
});

check('no workflow in this tree leaves a PAT in the workspace', () => {
  // The whole-tree half. autofix.yml is the reason this rule exists: it took the
  // PAT on the checkout, then ran `npm ci` over a contributor's lockfile with the
  // credential sitting in .git/config. It now checks out credential-free and
  // hands the token to the push step through `env:`.
  const dir = path.join(REPO_ROOT, '.github/workflows');
  for (const file of fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
    const bad = persistedCredentials(fs.readFileSync(path.join(dir, file), 'utf8'));
    assert.deepEqual(bad, [], `${file} persists ${JSON.stringify(bad.map((c) => c.token))} into .git/config`);
  }
});

// --- the rewrite must not reformat the file it is fixing ----------------------
//
// `--resolve` runs unattended (`.github/workflows/pin-actions.yml`, weekly) and
// opens the pull request itself. On a CRLF checkout a `\n` join re-wrote every
// line of the workflow, so a one-line pin arrived as a whole-file diff, with
// nobody in the loop to notice. `ruff-ratchet.mjs` hit this first; the `eolOf`
// shape is now shared through workflow-yaml.mjs.

check('a rewrite keeps the line endings the file already had', () => {
  const lf = 'jobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4\n      - run: echo hi\n';
  const crlf = lf.replace(/\n/g, '\r\n');
  const sha = 'a'.repeat(40);

  const outLf = rewriteUses(lf, 'actions/checkout@v4', sha, 'v4');
  assert.equal(outLf.includes('\r\n'), false, 'an LF file must not gain CRLF');
  assert.match(outLf, new RegExp(`uses: actions/checkout@${sha} # v4`));

  const outCrlf = rewriteUses(crlf, 'actions/checkout@v4', sha, 'v4');
  assert.ok(
    outCrlf.split('\n').every((l, i, a) => i === a.length - 1 || l.endsWith('\r')),
    'a CRLF file must stay CRLF on every line',
  );
  // Exactly ONE line differs from the original — the whole point of `eolOf`.
  const before = crlf.split('\r\n');
  const after = outCrlf.split('\r\n');
  assert.equal(before.length, after.length);
  assert.equal(before.filter((l, i) => l !== after[i]).length, 1);
});

// --- and finally: the real tree, right now ------------------------------------
//
// The cases above prove the rules fire. This one proves they are pointed at
// something: it runs the checker over THIS repository's workflows and requires
// it clean, so the fixtures cannot drift into describing a gate that no longer
// matches the files.

check('every workflow in the tree scopes its token, and pins what is not allowlisted', () => {
  const dir = path.join(REPO_ROOT, '.github/workflows');
  const files = fs
    .readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => ({ file: `.github/workflows/${f}`, text: fs.readFileSync(path.join(dir, f), 'utf8') }));
  const f = runActionChecks(files, PIN_ALLOWLIST);
  assert.deepEqual(blocking(f), [], `blocking findings:\n${JSON.stringify(blocking(f), null, 2)}`);
});

console.log(`
${passed} checks passed.`);
