#!/usr/bin/env node
// The pipeline has a wall-clock, and until now nothing was allowed to say no to it.
//
// THE GAP THIS CLOSES: seven workflows now run lint, three test runtimes, the
// evals, the design-token and locale gates, the doc-sync and commit-convention
// checks, the ratchets, and SBOM + signing on release. Every one of them is a
// deliberate addition and every one of them costs minutes. With agents opening
// changes continuously, how long a pull request takes to go green IS the rate
// limiter on the whole loop — and it is the one number in CI that can only get
// worse quietly. `timeout-minutes` does not measure it: a timeout is a crash
// barrier at 25 or 30 minutes, so a job that drifts from 6 minutes to 18 passes
// every gate in this repository while halving the throughput of the lane.
//
// WHAT THIS IS: a declared per-job ceiling, checked against what the run
// actually took, in the run itself. It is the same shape as every other guardrail
// here — a number in a committed file with a `why`, a blocking check in CI, and
// `--tighten` to lower it — but its measurement comes from the GitHub API rather
// than from the tree, because wall-clock is not a function of the source.
//
// A NEW JOB WITH NO CEILING IS A FINDING, not a pass. That is the whole pressure
// this file applies: adding a gate to ci.yml now costs one line in ci-budget.json
// saying how long it may take and why, which is the moment to notice that the
// pipeline just got longer.
//
// HONESTY ABOUT THE FIRST NUMBERS. The ceilings shipped in ci-budget.json were
// NOT measured — this repository's run history is not readable from a sandbox.
// They are derived from a number the team already chose deliberately, each job's
// own `timeout-minutes`, at RATIO_OF_TIMEOUT below: a job that regularly spends
// more than 60% of its own kill-timeout is one bad week away from being killed
// by it. That makes them real ceilings (they can fire before the timeout does,
// which is what a budget has to be able to do) without pretending to a
// measurement nobody took. `--tighten` is what replaces them with the truth: it
// lowers every ceiling to what the run actually took plus `slackPercent`, and it
// can never raise one.
//
//   node scripts/perf/ci-budget.mjs                # the check (needs the run context)
//   node scripts/perf/ci-budget.mjs --json
//   node scripts/perf/ci-budget.mjs --tighten      # lower ceilings to observed + slack
//   node scripts/perf/ci-budget.mjs --run 123456   # judge a specific run
//
// CONTEXT it reads: GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_TOKEN (or GH_TOKEN),
// GITHUB_JOB_NAME (the budget job's own name, excluded from its own judgement —
// it is still running while it judges, so it has no duration yet).
//
// EXIT CODES: 0 within budget · 1 a job or the run exceeded its ceiling, a job in
// the run has no declared ceiling, or the budget file could not be believed (a
// budget this script cannot parse must never read as "nothing to check" — that is
// how a gate goes quiet) · 2 the run could not be read at all (no token, no
// network, an API error), which is reported as NOT MEASURED rather than as a pass.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BUDGET_FILE = 'ci-budget.json';

/**
 * The fraction of a job's own `timeout-minutes` that its first ceiling was set
 * to. Not a measurement — see the header. Kept here because the number has to be
 * re-derivable when a new job is added before anyone has a duration for it.
 */
export const RATIO_OF_TIMEOUT = 0.6;

// --- the budget file ----------------------------------------------------------

/**
 * Read and validate. Throws rather than returning a default: a budget file that
 * cannot be parsed has to fail the build, never widen it.
 */
export function loadBudget(root = REPO_ROOT) {
  const budget = JSON.parse(fs.readFileSync(path.join(root, BUDGET_FILE), 'utf8'));
  if (budget.version !== 1) throw new Error(`${BUDGET_FILE}: unsupported version ${budget.version}`);
  if (typeof budget.slackPercent !== 'number') throw new Error(`${BUDGET_FILE}: slackPercent must be a number`);
  if (!budget.jobs || typeof budget.jobs !== 'object') throw new Error(`${BUDGET_FILE}: 'jobs' must be an object`);
  if (!Number.isFinite(budget.run?.maxMinutes)) throw new Error(`${BUDGET_FILE}: 'run.maxMinutes' must be a number`);
  if (!budget.run?.why) throw new Error(`${BUDGET_FILE}: 'run' has no 'why'`);
  for (const [name, limit] of Object.entries(budget.jobs)) {
    if (!Number.isFinite(limit?.maxMinutes)) throw new Error(`${BUDGET_FILE}: job '${name}' has no numeric maxMinutes`);
    // A ceiling with no reason is how a budget becomes a number nobody dares
    // move. Same discipline as ts-debt.json and the `# ratchet:` marker in ruff.toml.
    if (!limit.why) throw new Error(`${BUDGET_FILE}: job '${name}' has no 'why'`);
    // WHICH WORKFLOW the job belongs to. Required since the budget stopped being
    // about ci.yml alone: two of the required contexts a pull request waits on
    // are review.yml's, they run as a SEPARATE run with a separate wall-clock,
    // and an entry that does not say which run it belongs to would be reported
    // as renamed-or-deleted by whichever of the two happened to be judged.
    if (!limit.workflow) throw new Error(`${BUDGET_FILE}: job '${name}' has no 'workflow'`);
  }
  if (!budget.run.workflow) throw new Error(`${BUDGET_FILE}: 'run' has no 'workflow'`);
  return budget;
}

// --- reading a run ------------------------------------------------------------

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * How long one job actually took, in minutes, or null when it has no duration to
 * report: still running (the budget job judging itself), skipped by an `if:`, or
 * cancelled. `null` is never treated as zero — an unmeasured job is excluded from
 * the verdict and SAID to be excluded.
 */
export function durationMinutes(job) {
  if (!job?.started_at || !job?.completed_at) return null;
  if (job.conclusion === 'skipped' || job.conclusion === 'cancelled') return null;
  const ms = Date.parse(job.completed_at) - Date.parse(job.started_at);
  if (!Number.isFinite(ms) || ms < 0) return null;
  return round1(ms / 60000);
}

/**
 * The run's own wall-clock: first job to start until last job to finish. This is
 * the number the question "how long does a PR take to go green" actually asks
 * about, and it is NOT the sum of the jobs — they run in parallel, so the sum
 * would grow every time a gate was moved off the critical path onto its own
 * runner, which is an improvement.
 */
export function runWallClockMinutes(jobs) {
  const starts = jobs.map((j) => Date.parse(j.started_at)).filter(Number.isFinite);
  const ends = jobs.map((j) => Date.parse(j.completed_at)).filter(Number.isFinite);
  if (!starts.length || !ends.length) return null;
  return round1((Math.max(...ends) - Math.min(...starts)) / 60000);
}

// --- the verdict --------------------------------------------------------------

const withSlack = (n, slackPercent) => Math.ceil(n * (1 + slackPercent / 100));

/**
 * Judge a run against the budget. Pure: `jobs` is the API's job list.
 *
 * `self` is the name of the job doing the judging, excluded because it has not
 * finished yet — including it would either be a null it has to special-case or,
 * worse, a duration of zero that quietly lowers the run's measured wall-clock.
 */
export function evaluate(budget, jobs, { self = null } = {}) {
  const findings = [];
  const rows = [];
  const judged = [];

  for (const job of jobs) {
    if (self && job.name === self) continue;
    const minutes = durationMinutes(job);
    const limit = budget.jobs[job.name];
    if (minutes === null) {
      rows.push({ name: job.name, minutes: null, maxMinutes: limit?.maxMinutes ?? null, state: job.conclusion ?? job.status ?? 'unknown' });
      continue;
    }
    judged.push(job);
    if (!limit) {
      // The pressure this file exists to apply. A gate can be added; it cannot be
      // added without saying what it may cost.
      findings.push({
        kind: 'undeclared',
        target: job.name,
        message:
          `ran for ${minutes} min and has no ceiling in ${BUDGET_FILE}. ` +
          'Every job on the critical path of a pull request declares how long it may take and why — ' +
          'add an entry, and use the moment to decide whether the pipeline should have grown.',
      });
      rows.push({ name: job.name, minutes, maxMinutes: null, state: job.conclusion });
      continue;
    }
    rows.push({ name: job.name, minutes, maxMinutes: limit.maxMinutes, state: job.conclusion });
    if (minutes > limit.maxMinutes) {
      findings.push({
        kind: 'job',
        target: job.name,
        message: `took ${minutes} min, ceiling ${limit.maxMinutes} min (${limit.why})`,
      });
    }
  }

  // Which workflow this run IS, inferred from the entries its jobs matched
  // rather than from the environment: the API's job list is the only thing that
  // is true for both a live run and a `--run <id>` of a past one.
  const judgedWorkflows = new Set(rows.map((r) => budget.jobs[r.name]?.workflow));

  const runMinutes = runWallClockMinutes(judged);
  if (runMinutes !== null && judgedWorkflows.has(budget.run.workflow) && runMinutes > budget.run.maxMinutes) {
    findings.push({
      kind: 'run',
      target: '(whole run)',
      message: `the run took ${runMinutes} min wall-clock, ceiling ${budget.run.maxMinutes} min (${budget.run.why})`,
    });
  }

  // A stale entry is its own rot: it reads as a governed job long after the job
  // was renamed, and the rename is exactly how a ceiling stops applying. Only
  // reported when the run was complete enough to say so.
  // …and scoped to that workflow: a review.yml run contains no ci.yml jobs, so
  // reporting the other workflow's entries as renamed-or-deleted would be a
  // finding on every single run.
  const seen = new Set(rows.map((r) => r.name));
  for (const [name, limit] of Object.entries(budget.jobs)) {
    if (!judgedWorkflows.has(limit.workflow)) continue;
    if (!seen.has(name) && judged.length) {
      findings.push({
        kind: 'stale',
        target: name,
        message:
          `${BUDGET_FILE} budgets a job no run reports. It was renamed or deleted — ` +
          'delete the entry, or fix the name, because right now nothing holds it to anything.',
      });
    }
  }

  return { findings, rows, runMinutes };
}

/**
 * Lower every ceiling the pipeline has got faster than, and never raise one.
 *
 * `--tighten` is the half of a ratchet that can run unattended, so it must be
 * incapable of widening a budget: a duration ABOVE the ceiling is a finding for
 * the gate to report, not a new ceiling to record.
 */
export function tighten(budget, rows, runMinutes) {
  const next = structuredClone(budget);
  let changed = 0;
  for (const row of rows) {
    if (row.minutes === null) continue;
    const limit = next.jobs[row.name];
    if (!limit) continue;
    const want = withSlack(row.minutes, budget.slackPercent);
    if (want < limit.maxMinutes) {
      limit.maxMinutes = want;
      changed++;
    }
  }
  if (runMinutes !== null) {
    const want = withSlack(runMinutes, budget.slackPercent);
    if (want < next.run.maxMinutes) {
      next.run.maxMinutes = want;
      changed++;
    }
  }
  return { budget: next, changed };
}

/** The table a human reads, over-budget rows first. */
export function render({ findings, rows, runMinutes }, budget) {
  const lines = [];
  const measured = rows.filter((r) => r.minutes !== null).sort((a, b) => b.minutes - a.minutes);
  lines.push(`ci:budget — ${measured.length} job(s) measured against ${BUDGET_FILE}`);
  for (const r of measured) {
    const ceiling = r.maxMinutes === null ? 'no ceiling' : `ceiling ${r.maxMinutes}`;
    const over = r.maxMinutes !== null && r.minutes > r.maxMinutes ? '  OVER' : '';
    lines.push(`  ${String(r.minutes).padStart(6)} min  ${r.name}  (${ceiling})${over}`);
  }
  for (const r of rows.filter((x) => x.minutes === null)) {
    lines.push(`       — min  ${r.name}  (${r.state}: not measured)`);
  }
  if (runMinutes !== null) {
    lines.push(`  ${String(runMinutes).padStart(6)} min  (whole run, wall-clock)  (ceiling ${budget.run.maxMinutes})`);
  }
  if (!findings.length) {
    lines.push('ci:budget: the pipeline is within its declared wall-clock.');
    return lines.join('\n');
  }
  lines.push('', `ci:budget: ${findings.length} finding(s) — the pipeline costs more time than ${BUDGET_FILE} allows.`, '');
  for (const f of findings) lines.push(`  ${f.target}: ${f.message}`);
  lines.push(
    '',
    'Make the job faster (cache, split, move it off the critical path), or raise the ceiling in',
    `${BUDGET_FILE} with a 'why' a reviewer can disagree with. Raising one is a decision somebody`,
    'signs; lowering one is `node scripts/perf/ci-budget.mjs --tighten`.',
  );
  return lines.join('\n');
}

/** Where a ceiling could be, given what this run measured. Reported, never written. */
export function suggestions(budget, rows, runMinutes) {
  const out = [];
  for (const row of rows) {
    if (row.minutes === null || row.maxMinutes === null) continue;
    const want = withSlack(row.minutes, budget.slackPercent);
    if (want < row.maxMinutes) out.push(`${row.name}: ${row.maxMinutes} -> ${want}`);
  }
  if (runMinutes !== null) {
    const want = withSlack(runMinutes, budget.slackPercent);
    if (want < budget.run.maxMinutes) out.push(`(whole run): ${budget.run.maxMinutes} -> ${want}`);
  }
  return out;
}

// --- the API (the only impure part) -------------------------------------------

/** Every job of one run. Paginated: a run with more than 100 jobs is not a special case. */
export async function fetchJobs({ repo, runId, token, fetchImpl = fetch }) {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const url = `https://api.github.com/repos/${repo}/actions/runs/${runId}/jobs?per_page=100&page=${page}`;
    const res = await fetchImpl(url, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'kp-ci-budget',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) throw new Error(`GET ${url} returned ${res.status}`);
    const body = await res.json();
    const jobs = body.jobs ?? [];
    out.push(...jobs);
    if (jobs.length < 100) break;
  }
  return out;
}

// --- CLI ----------------------------------------------------------------------

export function parseArgs(argv) {
  const out = { json: false, tighten: false, run: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') out.json = true;
    else if (argv[i] === '--tighten') out.tighten = true;
    else if (argv[i] === '--run') out.run = argv[++i];
  }
  return out;
}

function writeSummary(text) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  try {
    fs.appendFileSync(file, `### Pipeline wall-clock\n\n\`\`\`\n${text}\n\`\`\`\n`);
  } catch {
    /* a summary that cannot be written is not a reason to fail the gate */
  }
}

async function main(argv) {
  const args = parseArgs(argv);

  let budget;
  try {
    budget = loadBudget();
  } catch (err) {
    console.error(`ci:budget: ${err.message}`);
    return 1;
  }

  const repo = process.env.GITHUB_REPOSITORY;
  const runId = args.run || process.env.GITHUB_RUN_ID;
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
  if (!repo || !runId) {
    // NOT a pass. This script only has an answer inside a run, and saying so is
    // the difference between "measured and fine" and "never looked".
    console.error(
      'ci:budget: NOT MEASURED — no GITHUB_REPOSITORY / GITHUB_RUN_ID in the environment.\n' +
        '  This reads the wall-clock of a real run from the API; it has no answer outside one.\n' +
        '  Pass --run <id> with GITHUB_REPOSITORY set to judge a past run locally.',
    );
    return 2;
  }

  let jobs;
  try {
    jobs = await fetchJobs({ repo, runId, token });
  } catch (err) {
    console.error(`ci:budget: NOT MEASURED — could not read run ${runId}: ${err.message}`);
    return 2;
  }

  const result = evaluate(budget, jobs, { self: process.env.GITHUB_JOB_NAME || null });

  if (args.tighten) {
    const { budget: next, changed } = tighten(budget, result.rows, result.runMinutes);
    if (changed) {
      const file = path.join(REPO_ROOT, BUDGET_FILE);
      const current = fs.readFileSync(file, 'utf8');
      const eol = current.includes('\r\n') ? '\r\n' : '\n';
      fs.writeFileSync(file, JSON.stringify(next, null, 2).split('\n').join(eol) + eol);
      console.log(`ci:budget --tighten: lowered ${changed} ceiling(s) in ${BUDGET_FILE}.`);
    } else {
      console.log('ci:budget --tighten: no ceiling is looser than this run.');
    }
  }

  if (args.json) {
    console.log(JSON.stringify({ ok: result.findings.length === 0, ...result }, null, 2));
    return result.findings.length ? 1 : 0;
  }

  const text = render(result, budget);
  console.log(text);

  // The headroom nobody is using, printed but never written: tightening a
  // ceiling is a commit somebody makes, and this is the line that tells them it
  // is worth making.
  const room = suggestions(budget, result.rows, result.runMinutes);
  const suffix = room.length
    ? `\n\nHeadroom this run did not use (\`--tighten\` writes these):\n${room.map((s) => `  ${s}`).join('\n')}`
    : '';
  if (room.length) console.log(suffix.trimStart());
  writeSummary(text + suffix);

  return result.findings.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`ci:budget: ${err.message}`);
      process.exit(2);
    });
}
