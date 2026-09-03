#!/usr/bin/env node
// Fixtures for the flake policy. No deps — run with:
//   node scripts/test/__tests__/flake-policy.test.mjs   (npm run test:flake)
//
// The load-bearing cases are the four at the bottom. A FLAKE must still block —
// the whole point is that "run it again" stops being the cheap path — a
// quarantine must NOT block, an unreadable register must never read as "nothing
// is quarantined", and the register this repository actually ships must be valid
// against the tree it actually has.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  MAX_QUARANTINE_DAYS,
  checkRegister,
  classifyRun,
  entryKey,
  isFileLevel,
  isQuarantined,
  loadRegister,
  main,
  parseDay,
  registerBlocks,
  renderRun,
} from '../flake-policy.mjs';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const DAY = 86_400_000;
const TODAY = Date.parse('2026-09-02T12:00:00.000Z');
const day = (offsetDays) => new Date(TODAY + offsetDays * DAY).toISOString().slice(0, 10);

/** Every file named by these fixtures exists; the `dead` rule gets its own. */
const allExist = () => true;

const clean = (over = {}) => ({
  file: 'app/_lib/example.test.ts',
  why: 'The scheduler test races the wall clock on a loaded runner; fixed by injecting the clock.',
  since: day(-1),
  expires: day(7),
  ...over,
});

const register = (quarantined, ceiling = quarantined.length) => ({ ceiling, quarantined, absent: false });

// --- reading the register -----------------------------------------------------

check('an ABSENT register is zero quarantined tests, not an error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kp-flake-fx-'));
  try {
    const r = loadRegister(dir);
    assert.deepEqual({ ceiling: r.ceiling, quarantined: r.quarantined }, { ceiling: 0, quarantined: [] });
    assert.deepEqual(checkRegister(r, allExist, TODAY), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

check('REFUSING TO GUESS: a register that lost its shape reads as null, never as empty', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kp-flake-fx-'));
  try {
    const write = (text) => fs.writeFileSync(path.join(dir, 'test-quarantine.json'), text);
    write('{ not json');
    assert.equal(loadRegister(dir), null);
    write('[]');
    assert.equal(loadRegister(dir), null);
    write('{"ceiling": 0}');
    assert.equal(loadRegister(dir), null, 'no `quarantined` array');
    write('{"quarantined": []}');
    assert.equal(loadRegister(dir), null, 'no ceiling');
    write('{"ceiling": -1, "quarantined": []}');
    assert.equal(loadRegister(dir), null, 'a negative ceiling is not a ceiling');
    write('{"ceiling": 0, "quarantined": []}');
    assert.deepEqual(loadRegister(dir).quarantined, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

check('an unreadable register BLOCKS — the misreading that would un-quarantine everything', () => {
  const findings = checkRegister(null, allExist, TODAY);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, 'unreadable');
  assert.equal(registerBlocks(findings), true);
});

// --- the entry rules ----------------------------------------------------------

check('a complete entry is silent', () => {
  assert.deepEqual(checkRegister(register([clean()]), allExist, TODAY), []);
});

check('DEAD: an entry naming a file the tree no longer has', () => {
  const findings = checkRegister(register([clean()]), () => false, TODAY);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, 'dead');
  assert.equal(registerBlocks(findings), true);
});

check('UNEXPLAINED: no file, no why, a why too short to be one, no dates, or a duplicate', () => {
  const rule = (entry) => checkRegister(register([entry]), allExist, TODAY).map((f) => f.rule);
  assert.deepEqual(rule({ why: 'x'.repeat(30), since: day(-1), expires: day(7) }), ['unexplained'], 'no file');
  assert.deepEqual(rule(clean({ why: undefined })), ['unexplained']);
  assert.deepEqual(rule(clean({ why: 'flaky' })), ['unexplained'], 'a five-character reason is not one');
  assert.deepEqual(rule(clean({ since: undefined })), ['unexplained']);
  assert.deepEqual(rule(clean({ expires: '7 days' })), ['unexplained'], 'dates are YYYY-MM-DD');

  const dupes = checkRegister(register([clean(), clean()], 2), allExist, TODAY);
  assert.equal(dupes.length, 1);
  assert.equal(dupes[0].rule, 'unexplained');
});

check('EXPIRED: a quarantine is a loan with a due date', () => {
  const rule = (entry) => checkRegister(register([entry]), allExist, TODAY).map((f) => f.rule);
  assert.deepEqual(rule(clean({ since: day(-10), expires: day(-1) })), ['expired'], 'came due yesterday');
  assert.deepEqual(rule(clean({ since: day(0), expires: day(0) })), ['expired'], 'expires when it starts');
  assert.deepEqual(
    rule(clean({ since: day(0), expires: day(MAX_QUARANTINE_DAYS + 1) })),
    ['expired'],
    `no entry may run longer than ${MAX_QUARANTINE_DAYS} days`,
  );
  assert.deepEqual(rule(clean({ since: day(0), expires: day(MAX_QUARANTINE_DAYS) })), [], 'exactly at the limit is allowed');
});

check('one entry may name one test rather than the whole file', () => {
  assert.deepEqual(checkRegister(register([clean({ test: 'the one racy case' })]), allExist, TODAY), []);
  assert.notEqual(entryKey(clean()), entryKey(clean({ test: 'a' })));
});

// --- the ceiling, on the shared ratchet's ladder ------------------------------

check('GREW blocks; SLACK is a note the ceiling should follow down', () => {
  const grew = checkRegister(register([clean(), clean({ file: 'app/_lib/other.test.ts' })], 1), allExist, TODAY);
  assert.equal(grew.filter((f) => f.rule === 'grew').length, 1);
  assert.equal(registerBlocks(grew), true);

  const slack = checkRegister(register([clean()], 3), allExist, TODAY);
  assert.deepEqual(slack.map((f) => f.rule), ['slack']);
  assert.equal(registerBlocks(slack), false, 'making a fix a red build taxes the fix rather than the debt');
});

check('a ceiling above an empty list is a note, and 0/0 is silence', () => {
  assert.deepEqual(checkRegister(register([], 2), allExist, TODAY).map((f) => f.rule), ['zero']);
  assert.deepEqual(checkRegister(register([], 0), allExist, TODAY), []);
});

// --- classifying a failing run ------------------------------------------------

const failure = (file, name = 'a case') => ({ file, name });
const EMPTY = register([], 0);

check('BROKEN: failed twice', () => {
  const { rows, blocking } = classifyRun({
    first: [failure('a.test.ts')],
    second: [failure('a.test.ts')],
    register: EMPTY,
  });
  assert.deepEqual(rows.map((r) => r.verdict), ['broken']);
  assert.equal(blocking, true);
});

check('FLAKE: failed, then passed — AND IT STILL BLOCKS', () => {
  // The load-bearing decision. Retrying until green would turn a flake from a
  // visible cost into an invisible one, and the suite's own sensitivity would
  // fall with nothing reporting it.
  const outcome = classifyRun({ first: [failure('a.test.ts')], second: [], register: EMPTY });
  assert.deepEqual(outcome.rows.map((r) => r.verdict), ['flake']);
  assert.equal(outcome.blocking, true, 'a flake that does not fail anything is a flake nobody fixes');
  const report = renderRun(outcome);
  assert.match(report, /FLAKE/);
  assert.match(report, /test-quarantine\.json/, 'the report names the one deliberate way out');
});

check('QUARANTINE: a declared failure is reported and does not block', () => {
  const declared = register([clean({ file: 'a.test.ts' })]);
  const outcome = classifyRun({ first: [failure('a.test.ts')], second: [failure('a.test.ts')], register: declared });
  assert.deepEqual(outcome.rows.map((r) => r.verdict), ['quarantined']);
  assert.equal(outcome.blocking, false);
  assert.match(renderRun(outcome), /QUARANTINE/);
});

check('a test-scoped entry excuses that test and nothing else in the file', () => {
  const declared = register([clean({ file: 'a.test.ts', test: 'the racy one' })]);
  assert.equal(isQuarantined(declared, failure('a.test.ts', 'the racy one')), true);
  assert.equal(isQuarantined(declared, failure('a.test.ts', 'a different case')), false);
  // A file whose OTHER case failed too is not excused: the entry covers one name.
  const outcome = classifyRun({
    first: [failure('a.test.ts', 'the racy one'), failure('a.test.ts', 'a different case')],
    second: [],
    register: declared,
  });
  assert.deepEqual(outcome.rows.map((r) => r.verdict), ['flake']);
  assert.equal(outcome.blocking, true);
});

check('a file-scoped entry excuses every case in it', () => {
  const declared = register([clean({ file: 'a.test.ts' })]);
  assert.equal(isQuarantined(declared, failure('a.test.ts', 'anything at all')), true);
  assert.equal(isQuarantined(declared, failure('b.test.ts')), false);
});

check('WITHOUT a re-run the verdict is `unknown`, never a guessed flake', () => {
  const outcome = classifyRun({ first: [failure('a.test.ts')], second: [], register: EMPTY, rerun: false });
  assert.deepEqual(outcome.rows.map((r) => r.verdict), ['unknown']);
  assert.equal(outcome.blocking, true);
  assert.match(renderRun(outcome), /not re-run/);
});

check('a green run has nothing to report', () => {
  const outcome = classifyRun({ first: [], second: [], register: EMPTY });
  assert.deepEqual(outcome.rows, []);
  assert.equal(outcome.blocking, false);
  assert.equal(renderRun(outcome), '');
});

check('failures are grouped by FILE, because a file is what gets re-run', () => {
  const outcome = classifyRun({
    first: [failure('a.test.ts', 'one'), failure('a.test.ts', 'two'), failure('b.test.ts', 'three')],
    second: [failure('b.test.ts', 'three')],
    register: EMPTY,
  });
  assert.deepEqual(
    outcome.rows.map((r) => [r.file, r.verdict, r.names.length]),
    [['a.test.ts', 'flake', 2], ['b.test.ts', 'broken', 1]],
  );
});

check('the synthetic file-level failure does not defeat a test-scoped entry', () => {
  // Process isolation makes each FILE a test too, so a failing file emits a
  // record whose name IS the file. Counting that as a test name would mean a
  // `test:`-scoped quarantine could never match everything a file reported, and
  // every narrow entry in the register would silently do nothing.
  assert.equal(isFileLevel({ file: 'app/_lib/a.test.ts', name: 'app/_lib/a.test.ts' }), true);
  assert.equal(isFileLevel({ file: 'app/_lib/a.test.ts', name: 'a.test.ts' }), true);
  assert.equal(isFileLevel({ file: 'app/_lib/a.test.ts', name: 'the racy one' }), false);

  const declared = register([clean({ file: 'app/_lib/a.test.ts', test: 'the racy one' })]);
  const outcome = classifyRun({
    first: [failure('app/_lib/a.test.ts', 'the racy one'), failure('app/_lib/a.test.ts', 'app/_lib/a.test.ts')],
    second: [],
    register: declared,
  });
  assert.deepEqual(outcome.rows.map((r) => r.verdict), ['quarantined']);

  // …but a file that never ran a test has only the synthetic record, and a
  // test-scoped entry genuinely does not cover it.
  const importThrew = classifyRun({
    first: [failure('app/_lib/a.test.ts', 'app/_lib/a.test.ts')],
    second: [],
    register: declared,
  });
  assert.deepEqual(importThrew.rows.map((r) => r.verdict), ['flake']);
});

check('parseDay is UTC and refuses anything that is not YYYY-MM-DD', () => {
  assert.equal(parseDay('2026-09-02'), Date.parse('2026-09-02T00:00:00.000Z'));
  assert.ok(Number.isNaN(parseDay('2 September 2026')));
  assert.ok(Number.isNaN(parseDay(undefined)));
});

// --- the register this repository actually ships ------------------------------

check('THE REAL REGISTER IS VALID AGAINST THE REAL TREE', () => {
  // The case that keeps the gate honest rather than only well-tested: every rule
  // above runs against fixtures, and this one runs against the file that is
  // committed and the files that are on disk. `main` is what the launcher's
  // pre-flight does, so a red build from a dead or expired entry is reproducible
  // in one command.
  const lines = [];
  const code = main(REPO_ROOT, Date.now(), (s) => lines.push(s));
  assert.equal(code, 0, lines.join('\n'));
});

console.log(`\nflake-policy fixtures: ${passed} checks passed.`);
