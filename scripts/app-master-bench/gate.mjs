#!/usr/bin/env node
// Turn a bench sweep into a VERDICT something can depend on.
//
//   node scripts/app-master-bench/gate.mjs [--bench bench/app-master] [--json]
//                                          [--max-age-days 14]
//   npm run bench:gate
//
// WHY: the sweep already produces per-run `result.json` files and an aggregated
// REPORT.md. Both are read by a human, and the durable outcome has been landing
// in COMMIT BODIES ("R2 green 6/6, sweep #23"). That has two costs. The next
// agent can only learn the current standing by reading `git log` and trusting
// the prose. And nothing anywhere fails when the number goes backwards — the
// signal depends on somebody choosing to look, which is exactly the habit that
// erodes when work speeds up.
//
// This reads the NEWEST run per scenario, compares it against the committed
// baseline (`baseline.json`, beside this file), writes a machine-readable
// `gate.json` into the bench root, and exits non-zero on a regression.
//
// WHAT COUNTS AS A REGRESSION:
//   - a baselined scenario has no run in the sweep at all       (missing)
//   - its run did not complete                                  (result.ok false)
//   - an expectation the baseline requires is absent from the record
//     (unmeasured is not zero — a check quietly dropped from a scenario file is
//      a coverage regression a pass/fail count cannot see)
//   - any expectation in the record failed
//   - the run ran against the IN-PROCESS STUB Personas (`personas.stub: true`).
//     The stub does not run an agent, gate a branch or spend a cent — every
//     number a stub row carries is canned, and stub.mjs's own header plus the
//     aggregate report both say so loudly. Until this check existed the gate was
//     the one reader that never asked, so a full sweep against canned Personas
//     exited 0 while the report beside it printed "EVERYTHING IT REPORTS IS
//     CANNED". A verdict that green means nothing is worse than no verdict.
//   - a baselined NUMBER regressed past its tolerance, or was not measured at
//     all. `mustPass` + `requiredExpectations` cannot see this: a tenure that
//     fell from five opened proposals to one met every check it declared.
//   - the run's repo scan was REUSED (`scan.reused: true`). kp coalesces a
//     second scan of one target for 30 minutes and four scenarios share one
//     root, so a sweep could measure the scan engine ONCE and hand the other
//     three a copy. A graded copy is not a measurement.
//   - the run is STALE: it finished before the baseline it is being compared to
//     was recorded (a run cannot certify a bar that was raised after it), or it
//     is older than `--max-age-days` (default 14). A month-old green run says
//     the App master worked a month ago; the gate is asked whether it works now.
//     A run whose `finishedAt` cannot be parsed is undatable, and undatable is
//     not fresh.
//
// A scenario present in the sweep but absent from the baseline is reported as
// `unbaselined` and does NOT fail: new scenarios land before their number is
// trusted. It is listed loudly so nobody mistakes silence for coverage.
//
// PURE CORE: `evaluateSweep` / `renderGate` are filesystem-free and covered by
// gate.test.mjs. Only `main` touches disk.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GLYPH_NA, glyph, parseArgs, verdictBanner } from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const DEFAULT_BENCH_ROOT = path.join(REPO_ROOT, "bench", "app-master");
const BASELINE_PATH = path.join(HERE, "baseline.json");

/** How old the newest run per scenario may be before the gate stops trusting it. */
export const DEFAULT_MAX_AGE_DAYS = 14;

const MS_PER_DAY = 86_400_000;

/**
 * Where each baselined NUMBER is read out of a run record.
 *
 * The same paths REPORT.md prints, and the same reduction: the BUSIEST night,
 * not the last one. A tenure whose second night is quiet did not regress, and a
 * bar that says otherwise gets ignored within a week.
 *
 * A metric name the baseline uses but this table does not know is a problem
 * rather than a silent skip — a bar nothing reads is a bar that never fails.
 */
export const METRIC_READERS = {
  proposalsOpened: (n) => n?.reading?.proposalsOpened,
  proposalsMerged: (n) => n?.reading?.proposalsMerged,
  proposalsReverted: (n) => n?.reading?.proposalsReverted,
  gatePassRate: (n) => n?.reading?.gatePassRate,
  forbiddenClassViolations: (n) => n?.reading?.forbiddenClassViolations,
  backboneScore: (n) => n?.backbone?.score,
  backboneCoverage: (n) => n?.backbone?.coverage,
};

/** The busiest night's value for one metric, or null when no night measured it. */
function measuredMetric(record, name) {
  const read = METRIC_READERS[name];
  if (!read) return undefined; // unknown metric — the caller reports it
  const values = (record?.nights ?? []).map(read).filter((v) => typeof v === "number" && Number.isFinite(v));
  return values.length ? Math.max(...values) : null;
}

/**
 * Compare one run's numbers against a scenario's baselined bars.
 *
 * `mustPass` + `requiredExpectations` cannot see this class of regression at
 * all: a tenure that fell from five opened proposals to one measured every
 * required check and met every one of its own floors, and nothing compared it to
 * the run before. The bars are absolute, the tolerance is a FRACTION of the bar
 * (so a metric that wobbles run to run does not cry wolf), and an absent number
 * is a problem — unmeasured is not zero, here as everywhere else in this file.
 */
export function compareMetrics(record, spec) {
  const problems = [];
  const metrics = spec?.metrics;
  if (!metrics || Object.keys(metrics).length === 0) return { metered: false, problems };
  const tolerance = Number.isFinite(spec.tolerance) ? Math.abs(spec.tolerance) : 0;
  for (const [name, bar] of Object.entries(metrics)) {
    const actual = measuredMetric(record, name);
    if (actual === undefined) {
      problems.push(`metric "${name}" is baselined but nothing in gate.mjs reads it (METRIC_READERS)`);
      continue;
    }
    if (actual === null) {
      problems.push(`metric "${name}" was not measured in this run (baselined ${JSON.stringify(bar)})`);
      continue;
    }
    if (typeof bar?.atLeast === "number") {
      const floor = bar.atLeast - Math.abs(bar.atLeast) * tolerance;
      if (actual < floor) {
        problems.push(
          `${name} fell to ${actual} — the baseline says at least ${bar.atLeast} (tolerance ${tolerance}, so ${floor})`,
        );
      }
    } else if (typeof bar?.atMost === "number") {
      const ceiling = bar.atMost + Math.abs(bar.atMost) * tolerance;
      if (actual > ceiling) {
        problems.push(
          `${name} rose to ${actual} — the baseline says at most ${bar.atMost} (tolerance ${tolerance}, so ${ceiling})`,
        );
      }
    } else {
      problems.push(`metric "${name}" declares neither atLeast nor atMost — a bar with no direction cannot fail`);
    }
  }
  return { metered: true, problems };
}

/** `2026-08-26` (a baseline stamp) or a full ISO instant → epoch ms, or null. */
function instant(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Compare a sweep against the baseline.
 *
 * @param baseline  parsed baseline.json
 * @param runs      [{ scenario, finishedAt, result }] — one entry per run record
 * @param options   { now, maxAgeDays } — injected so freshness is testable
 * @returns { ok, rows, unbaselined, counts }
 */
export function evaluateSweep(baseline, runs, { now = new Date(), maxAgeDays = DEFAULT_MAX_AGE_DAYS } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const baselineAt = instant(baseline?.recordedAt);
  const newest = new Map();
  for (const run of runs) {
    if (!run?.scenario) continue;
    const prev = newest.get(run.scenario);
    // Sort by finishedAt when both have one; otherwise last wins (the caller
    // hands them over in directory order, which is already stamped-sortable).
    if (!prev || String(run.finishedAt ?? "") >= String(prev.finishedAt ?? "")) {
      newest.set(run.scenario, run);
    }
  }

  const rows = [];
  for (const [scenario, spec] of Object.entries(baseline.scenarios ?? {})) {
    const run = newest.get(scenario);
    if (!run) {
      rows.push({
        scenario,
        verdict: "missing",
        ok: false,
        reason: "the baseline expects this scenario; the sweep has no run for it",
        expectations: [],
        finishedAt: null,
      });
      continue;
    }

    const record = run.result ?? {};
    const expectations = Array.isArray(record.expectations) ? record.expectations : [];
    const byName = new Map(expectations.map((e) => [e.name, e]));
    // Three buckets so the VERDICT can name the dominant reason. A stub row and
    // a stale row both fail, but "re-run the sweep" and "this number is canned"
    // are different instructions, and a single `fail` count hides which one the
    // reader owes work on.
    const problems = [];
    const stubProblems = [];
    const reusedScanProblems = [];
    const staleProblems = [];

    for (const required of spec.requiredExpectations ?? []) {
      if (!byName.has(required)) {
        problems.push(`expectation "${required}" was not measured in this run`);
      }
    }
    // The NUMBERS. A scenario with `metrics: null` is UNMETERED — nobody has
    // committed a measurement for it — which is reported rather than counted as
    // covered, exactly like an unbaselined scenario. It is a gap to fill, not a
    // failure to invent.
    const metrics = compareMetrics(record, spec);
    problems.push(...metrics.problems);

    const failed = expectations.filter((e) => e.ok === false);
    for (const f of failed) {
      problems.push(`${f.name}: expected ${f.expected}, got ${f.actual}`);
    }
    if (spec.mustPass !== false && record.ok !== true) {
      const where = record.failedPhase ? ` (failed phase: ${record.failedPhase})` : "";
      problems.push(`the run did not complete${where}`);
    }

    const stub = record?.personas?.stub === true;
    if (stub) {
      stubProblems.push(
        "this run ran against the IN-PROCESS STUB Personas (--stub-personas): every number it carries is canned, so it certifies nothing",
      );
    }

    // A COPIED reading is the same class of nothing as a canned Personas, and it
    // was invisible for the same reason: nobody asked. Four of the seven committed
    // scenarios name one root, kp coalesces a repeat scan of a target it read in
    // the last 30 minutes, and the driver used to discard the `reused` flag — so
    // three of four kp runs could certify a dossier another run produced. Its own
    // bucket rather than a shared "canned" one, because the instruction differs:
    // drop --reuse-scan, not --stub-personas.
    //
    // `=== true` on purpose. A tenure run skips the whole preamble and carries no
    // `scan` block at all, and a missing flag is not evidence of reuse.
    const reusedScan = record?.scan?.reused === true;
    if (reusedScan) {
      reusedScanProblems.push(
        "this run's repo scan was COALESCED onto a reading another run had already taken (`reused: true`) — the dossier it graded is a copy, so it certifies nothing about the scan engine",
      );
    }

    const finishedAt = record.finishedAt ?? run.finishedAt ?? null;
    const finishedMs = instant(finishedAt);
    if (finishedMs === null) {
      staleProblems.push(
        `this run carries no readable finishedAt (${JSON.stringify(finishedAt)}) — an undatable run cannot be shown to be fresh`,
      );
    } else {
      if (baselineAt !== null && finishedMs < baselineAt) {
        staleProblems.push(
          `this run finished ${finishedAt}, BEFORE the baseline it is compared against was recorded (${baseline.recordedAt}) — it cannot certify a bar raised after it`,
        );
      }
      const ageDays = (nowMs - finishedMs) / MS_PER_DAY;
      if (Number.isFinite(ageDays) && ageDays > maxAgeDays) {
        staleProblems.push(
          `this run is ${ageDays.toFixed(1)} days old (max ${maxAgeDays}) — it says the App master worked then, not that it works now; re-run the sweep`,
        );
      }
    }

    const all = [...problems, ...stubProblems, ...reusedScanProblems, ...staleProblems];
    const verdict =
      all.length === 0
        ? "pass"
        : problems.length
          ? "fail"
          : stubProblems.length
            ? "stub"
            : reusedScanProblems.length
              ? "reused-scan"
              : "stale";

    rows.push({
      scenario,
      verdict,
      ok: all.length === 0,
      stub,
      reusedScan,
      metered: metrics.metered,
      reason: all.join("; ") || "every required expectation measured and met, on a fresh live run",
      expectations: expectations.map((e) => ({ name: e.name, ok: e.ok === true })),
      finishedAt: record.finishedAt ?? null,
    });
  }

  const unbaselined = [...newest.keys()].filter((s) => !(baseline.scenarios ?? {})[s]).sort();
  const counts = {
    total: rows.length,
    pass: rows.filter((r) => r.verdict === "pass").length,
    fail: rows.filter((r) => r.verdict === "fail").length,
    missing: rows.filter((r) => r.verdict === "missing").length,
    stub: rows.filter((r) => r.verdict === "stub").length,
    reusedScan: rows.filter((r) => r.reusedScan).length,
    unmetered: rows.filter((r) => r.verdict !== "missing" && !r.metered).length,
    stale: rows.filter((r) => r.verdict === "stale").length,
    unbaselined: unbaselined.length,
  };

  return { ok: rows.every((r) => r.ok), rows, unbaselined, counts, maxAgeDays };
}

/** The report a human reads. Same glyph set as every other report here. */
export function renderGate(gate, baseline) {
  const { counts, rows, unbaselined } = gate;
  const lines = [];
  lines.push(
    verdictBanner([
      gate.ok ? "BENCH GATE GREEN" : "BENCH GATE RED",
      `${counts.pass}/${counts.total} baselined scenarios pass`,
      counts.missing ? `${counts.missing} not run` : null,
      counts.stub ? `${counts.stub} CANNED (stub Personas)` : null,
      counts.reusedScan ? `${counts.reusedScan} COPIED scan (reused dossier)` : null,
      counts.stale ? `${counts.stale} stale` : null,
      counts.unmetered ? `${counts.unmetered} unmetered` : null,
      counts.unbaselined ? `${counts.unbaselined} unbaselined` : null,
      `baseline ${baseline.recordedAt ?? "?"}`,
    ]),
  );
  lines.push("");
  for (const row of rows) {
    const mark = row.verdict === "missing" ? GLYPH_NA : glyph(row.ok);
    lines.push(`  ${mark} ${row.scenario}`);
    lines.push(`      ${row.reason}`);
  }
  if (unbaselined.length) {
    lines.push("");
    lines.push(
      `  ${GLYPH_NA} unbaselined and therefore UNGATED: ${unbaselined.join(", ")}` +
        `\n      Add them to scripts/app-master-bench/baseline.json once their number is trusted.`,
    );
  }
  if (counts.stub) {
    lines.push("");
    lines.push(
      `  ${glyph(false)} ${counts.stub} scenario(s) were only run against the in-process STUB Personas.` +
        `\n      A stub run proves the driver's plumbing, not the App master's performance.` +
        `\n      Re-run those scenarios without --stub-personas before asking for a verdict.`,
    );
  }
  if (counts.unmetered) {
    lines.push("");
    lines.push(
      `  ${GLYPH_NA} ${counts.unmetered} scenario(s) are UNMETERED: baseline.json carries no numbers for` +
        `\n      them, so pass/fail is all the gate can say. A tenure can fall from five` +
        `\n      opened proposals to one without any of this going red. Record the numbers` +
        `\n      from a committed run and name the source in \`metricsFrom\`.`,
    );
  }
  if (counts.reusedScan) {
    lines.push("");
    lines.push(
      `  ${glyph(false)} ${counts.reusedScan} scenario(s) graded a COPIED scan: kp handed them a dossier` +
        `
      another run had already taken (the reuse window is 30 minutes, and four` +
        `
      scenarios share one root). Re-run them without --reuse-scan, so the sweep` +
        `
      measures the scan engine once per scenario instead of once per sweep.`,
    );
  }
  if (counts.stale) {
    lines.push("");
    lines.push(
      `  ${glyph(false)} ${counts.stale} scenario(s) have only a STALE run (max age ${gate.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS}d, --max-age-days).` +
        `\n      An old green run certifies the past. Re-run the sweep, or state a wider window on purpose.`,
    );
  }
  if (!gate.ok) {
    lines.push("");
    lines.push("  A red gate is either a real regression or a baseline that moved on purpose.");
    lines.push("  If it moved on purpose, edit baseline.json in the same change and say why.");
  }
  return lines.join("\n");
}

/** Read every `<runDir>/result.json` under a bench root. */
export function loadRuns(benchRoot) {
  const runsDir = path.join(benchRoot, "runs");
  if (!existsSync(runsDir)) return [];
  const out = [];
  for (const entry of readdirSync(runsDir).sort()) {
    const file = path.join(runsDir, entry, "result.json");
    if (!existsSync(file) || !statSync(file).isFile()) continue;
    let result;
    try {
      result = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      continue; // a half-written record from an interrupted run is not a verdict
    }
    out.push({
      scenario: result?.scenario?.name ?? null,
      finishedAt: result?.finishedAt ?? null,
      runDir: entry,
      result,
    });
  }
  return out;
}

function main(argv) {
  const args = parseArgs(argv);
  const benchRoot = args.bench ? path.resolve(REPO_ROOT, String(args.bench)) : DEFAULT_BENCH_ROOT;
  // A garbage --max-age-days is refused rather than silently falling back: a
  // typo'd window that quietly becomes 14 is the same class of lie the freshness
  // check exists to stop.
  let maxAgeDays = DEFAULT_MAX_AGE_DAYS;
  if (args["max-age-days"] !== undefined && args["max-age-days"] !== true) {
    maxAgeDays = Number(args["max-age-days"]);
    if (!Number.isFinite(maxAgeDays) || maxAgeDays < 0) {
      process.stderr.write(`bench:gate: --max-age-days must be a non-negative number, got "${args["max-age-days"]}".\n`);
      return 1;
    }
  }

  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  const runs = loadRuns(benchRoot);

  if (runs.length === 0) {
    // Not a pass. A gate with nothing to read has not certified anything, and
    // saying so is the whole discipline this file is built on.
    process.stderr.write(
      `bench:gate: no run records under ${path.relative(REPO_ROOT, benchRoot)}/runs/.\n` +
        `Run a sweep first: npm run bench:app-master\n`,
    );
    return 1;
  }

  const gate = evaluateSweep(baseline, runs, { maxAgeDays });
  const report = renderGate(gate, baseline);

  mkdirSync(benchRoot, { recursive: true });
  const outPath = path.join(benchRoot, "gate.json");
  writeFileSync(
    outPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        baselineRecordedAt: baseline.recordedAt ?? null,
        baselineRecordedFrom: baseline.recordedFrom ?? null,
        evaluatedAt: new Date().toISOString(),
        ...gate,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  process.stdout.write(args.json ? `${readFileSync(outPath, "utf8")}` : `${report}\n\nwrote ${path.relative(REPO_ROOT, outPath)}\n`);
  return gate.ok ? 0 : 1;
}

if (process.argv[1]?.endsWith("gate.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
