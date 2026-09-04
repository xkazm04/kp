#!/usr/bin/env node
// Fixtures for the pipeline wall-clock budget. No deps — run with:
//   node scripts/perf/__tests__/ci-budget.test.mjs
//
// The cases that matter most are the REFUSALS: a job with no ceiling must not
// pass, an unfinished or skipped job must not be scored as zero minutes, and
// `--tighten` must be incapable of raising a ceiling — it is the half of the
// ratchet that runs unattended.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BUDGET_FILE,
  REPO_ROOT,
  durationMinutes,
  evaluate,
  loadBudget,
  parseArgs,
  render,
  runWallClockMinutes,
  suggestions,
  tighten,
} from '../ci-budget.mjs';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

const at = (min) => new Date(Date.UTC(2026, 0, 1, 12, min, 0)).toISOString();
const job = (name, startMin, endMin, conclusion = 'success') => ({
  name,
  started_at: startMin === null ? null : at(startMin),
  completed_at: endMin === null ? null : at(endMin),
  conclusion,
  status: endMin === null ? 'in_progress' : 'completed',
});

/** The judging job's own name, excluded from the coupling assertion below. */
const BUDGET_JOB_NAME = 'Pipeline budget (wall-clock against ci-budget.json)';

const BUDGET = {
  version: 1,
  slackPercent: 25,
  run: { maxMinutes: 24, why: 'the wall-clock a pull request waits on' },
  jobs: {
    Fast: { maxMinutes: 3, why: 'a dependency-free script over the diff' },
    Slow: { maxMinutes: 15, why: 'the long pole' },
  },
};

// --- measurement --------------------------------------------------------------
check('a duration is the job’s own start-to-finish, rounded to a tenth', () => {
  assert.equal(durationMinutes(job('Fast', 0, 2)), 2);
  assert.equal(
    durationMinutes({ started_at: '2026-01-01T12:00:00Z', completed_at: '2026-01-01T12:00:30Z', conclusion: 'success' }),
    0.5,
  );
});

check('a job with no duration is never scored as zero', () => {
  // The budget job itself, judging the run it is still inside.
  assert.equal(durationMinutes(job('Budget', 0, null)), null);
  assert.equal(durationMinutes(job('Skipped', 0, 4, 'skipped')), null);
  assert.equal(durationMinutes(job('Cancelled', 0, 4, 'cancelled')), null);
  assert.equal(durationMinutes({}), null);
  // A clock that went backwards is unmeasured, not negative.
  assert.equal(durationMinutes(job('Odd', 5, 1)), null);
});

check('the run’s wall-clock is the span, not the sum — parallel jobs do not add up', () => {
  const jobs = [job('Fast', 0, 3), job('Slow', 0, 12), job('Other', 1, 5)];
  assert.equal(runWallClockMinutes(jobs), 12);
  assert.equal(runWallClockMinutes([]), null);
});

// --- the verdict --------------------------------------------------------------
check('a run inside every ceiling passes', () => {
  const { findings, runMinutes } = evaluate(BUDGET, [job('Fast', 0, 2), job('Slow', 0, 11)]);
  assert.deepEqual(findings, []);
  assert.equal(runMinutes, 11);
});

check('a job over its ceiling fails, and the message carries both numbers and the why', () => {
  const { findings } = evaluate(BUDGET, [job('Fast', 0, 2), job('Slow', 0, 17)]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, 'job');
  assert.equal(findings[0].target, 'Slow');
  assert.match(findings[0].message, /took 17 min/);
  assert.match(findings[0].message, /ceiling 15 min/);
  assert.match(findings[0].message, /the long pole/);
});

check('a run whose wall-clock exceeds the ceiling fails even when every job is inside its own', () => {
  const wide = { ...BUDGET, jobs: { Fast: { maxMinutes: 30, why: 'x' }, Slow: { maxMinutes: 30, why: 'y' } } };
  const { findings } = evaluate(wide, [job('Fast', 0, 20), job('Slow', 12, 40)]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, 'run');
  assert.match(findings[0].message, /40 min wall-clock/);
});

check('a job with no declared ceiling is a finding, not a pass', () => {
  const { findings } = evaluate(BUDGET, [job('Fast', 0, 2), job('Slow', 0, 3), job('A brand new gate', 0, 4)]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, 'undeclared');
  assert.equal(findings[0].target, 'A brand new gate');
  assert.match(findings[0].message, /no ceiling/);
});

check('the judging job excludes itself, so it is never "undeclared"', () => {
  const jobs = [job('Fast', 0, 2), job('Slow', 0, 3), job('Pipeline budget', 3, null)];
  const { findings, rows } = evaluate(BUDGET, jobs, { self: 'Pipeline budget' });
  assert.deepEqual(findings, []);
  assert.ok(!rows.some((r) => r.name === 'Pipeline budget'));
  // …and even without being told its own name, an unfinished job is unmeasured
  // rather than a zero-minute job with no ceiling.
  const blind = evaluate(BUDGET, jobs);
  assert.deepEqual(blind.findings, []);
  assert.equal(blind.rows.find((r) => r.name === 'Pipeline budget').minutes, null);
});

check('a skipped job is reported as unmeasured and judged on nothing', () => {
  const { findings, rows } = evaluate(BUDGET, [job('Fast', 0, 2), job('Slow', 0, 30, 'skipped')]);
  assert.deepEqual(findings, []);
  assert.equal(rows.find((r) => r.name === 'Slow').minutes, null);
});

check('a budgeted job no run reports is stale, and says so', () => {
  const { findings } = evaluate(BUDGET, [job('Fast', 0, 2)]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, 'stale');
  assert.equal(findings[0].target, 'Slow');
});

check('a run with nothing measurable reports no stale entries — it knows it saw nothing', () => {
  const { findings } = evaluate(BUDGET, [job('Fast', 0, null)]);
  assert.deepEqual(findings, []);
});

// --- the ratchet --------------------------------------------------------------
check('--tighten lowers a ceiling to the observed duration plus slack', () => {
  const { rows, runMinutes } = evaluate(BUDGET, [job('Fast', 0, 1), job('Slow', 0, 8)]);
  const { budget: next, changed } = tighten(BUDGET, rows, runMinutes);
  assert.equal(changed, 3); // Fast, Slow, and the run
  assert.equal(next.jobs.Fast.maxMinutes, 2); // ceil(1 * 1.25)
  assert.equal(next.jobs.Slow.maxMinutes, 10); // ceil(8 * 1.25)
  assert.equal(next.run.maxMinutes, 10);
  // The `why` survives: tightening a number never deletes its reason.
  assert.equal(next.jobs.Slow.why, BUDGET.jobs.Slow.why);
});

check('--tighten can never raise a ceiling, even on a run that blew through it', () => {
  const { rows, runMinutes } = evaluate(BUDGET, [job('Fast', 0, 1), job('Slow', 0, 40)]);
  const { budget: next, changed } = tighten(BUDGET, rows, runMinutes);
  assert.equal(next.jobs.Slow.maxMinutes, 15, 'an over-budget run is a finding, never a new ceiling');
  assert.equal(next.run.maxMinutes, 24);
  assert.equal(changed, 1); // only Fast moved: ceil(1 * 1.25) = 2, below its 3
  assert.equal(BUDGET.jobs.Slow.maxMinutes, 15, 'the input budget is not mutated');
});

check('unused headroom is reported without being written', () => {
  const { rows, runMinutes } = evaluate(BUDGET, [job('Fast', 0, 1), job('Slow', 0, 8)]);
  const room = suggestions(BUDGET, rows, runMinutes);
  assert.ok(room.some((s) => s.startsWith('Slow: 15 -> 10')));
});

// --- the file must be believable ---------------------------------------------
check('a budget that cannot be believed fails rather than passing vacuously', () => {
  const bad = (obj, re) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-budget-'));
    fs.writeFileSync(path.join(dir, BUDGET_FILE), JSON.stringify(obj));
    assert.throws(() => loadBudget(dir), re);
    fs.rmSync(dir, { recursive: true, force: true });
  };
  bad({ version: 2 }, /unsupported version/);
  bad({ version: 1 }, /slackPercent/);
  bad({ version: 1, slackPercent: 25 }, /'jobs' must be an object/);
  bad({ version: 1, slackPercent: 25, jobs: {} }, /run\.maxMinutes/);
  bad(
    { version: 1, slackPercent: 25, jobs: { A: { maxMinutes: 1 } }, run: { maxMinutes: 5, why: 'x' } },
    /job 'A' has no 'why'/,
  );
  bad(
    { version: 1, slackPercent: 25, jobs: { A: { why: 'x' } }, run: { maxMinutes: 5, why: 'x' } },
    /job 'A' has no numeric maxMinutes/,
  );
});

// --- the coupling this gate exists to protect --------------------------------
check('the committed budget parses, and every ci.yml job has a ceiling under its timeout', () => {
  const budget = loadBudget();
  const workflow = fs.readFileSync(path.join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8').replace(/\r\n/g, '\n');

  // CRLF normalized before matching: a Windows checkout with core.autocrlf=true turned this
  // gate red locally while CI stayed green, hiding a real failure behind a known one.
  // `name:` + `timeout-minutes:` at job level — the two lines the budget is
  // keyed on and derived from. A job renamed in the workflow and not here is
  // exactly the drift the `stale`/`undeclared` findings report at run time; this
  // asserts it offline, on every push, before a run has to discover it.
  const jobs = [...workflow.matchAll(/^    name: (.+)$\n(?:.*\n)*?^    timeout-minutes: (\d+)$/gm)].map((m) => ({
    name: m[1].trim(),
    timeout: Number(m[2]),
  }));
  assert.ok(jobs.length >= 5, `expected to find the ci.yml jobs, found ${jobs.length}`);

  for (const j of jobs) {
    if (j.name === BUDGET_JOB_NAME) continue; // the judge does not judge itself
    const limit = budget.jobs[j.name];
    assert.ok(limit, `ci.yml job "${j.name}" has no ceiling in ${BUDGET_FILE}`);
    assert.ok(
      limit.maxMinutes < j.timeout,
      `"${j.name}" is budgeted at ${limit.maxMinutes} min but killed at ${j.timeout} — a ceiling at or above ` +
        'the timeout can never fire first, which makes it decoration',
    );
  }

  const names = new Set(jobs.map((j) => j.name));
  for (const name of Object.keys(budget.jobs)) {
    assert.ok(names.has(name), `${BUDGET_FILE} budgets "${name}", which ci.yml no longer defines`);
  }

  assert.ok(
    budget.run.maxMinutes >= Math.max(...Object.values(budget.jobs).map((l) => l.maxMinutes)),
    'the run ceiling must not be below the slowest job it contains, or it can never be met',
  );
});

check('cli args parse', () => {
  assert.deepEqual(parseArgs(['--json']), { json: true, tighten: false, run: null });
  assert.deepEqual(parseArgs(['--tighten', '--run', '99']), { json: false, tighten: true, run: '99' });
});

check('the report names the over-budget job and how to answer it', () => {
  const result = evaluate(BUDGET, [job('Fast', 0, 2), job('Slow', 0, 17)]);
  const text = render(result, BUDGET);
  assert.match(text, /OVER/);
  assert.match(text, /Slow/);
  assert.match(text, /--tighten/);
});

console.log(`\nci-budget fixtures: ${passed} checks passed.`);
