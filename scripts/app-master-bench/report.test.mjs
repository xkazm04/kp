// The aggregate report renderer, over a RECORDED run.
//
//   node --test scripts/app-master-bench/
//
// `__fixtures__/result-stub.json` is a real `result.json`, produced against a
// throwaway keyless kp and the in-process stub Personas. It is committed because
// `bench/` is not: the runs a sweep writes are local artifacts, and a renderer
// test that depends on one would pass only on the machine that last ran the
// bench.
//
// REGENERATE (never hand-edit — the point of a recorded fixture is that the
// renderer is proven against the shape the driver actually writes):
//
//   1. A keyless kp on a throwaway DB. `next dev` is fine; a production build is
//      what CI uses, and inside a git WORKTREE only the webpack build works:
//        npx next build --webpack
//        cp -r .next/static .next/standalone/.next/static
//        cp -r public pipeline data .next/standalone/     # the spawned python
//                                                          side and its data
//        PORT=3117 KP_ALLOW_OPEN=1 KP_OFFLINE=1 \
//        KP_APP_MASTER_REPO_ROOTS=<dir holding the checkout> \
//        KP_DB_PATH=<throwaway>.sqlite node .next/standalone/server.js
//      KP_APP_MASTER_REPO_ROOTS is required or the `scan` phase 400s, and the
//      pipeline/ + data/ copies are required or `intake` 500s: the traced
//      standalone tree carries neither the .py files nor data/salary_benchmarks.json.
//   2. The run:
//        KP_ROOT=<checkout> node scripts/app-master-bench/run.mjs \
//          --scenario kp-default --kp http://localhost:3117 --stub-personas
//   3. Copy that run's result.json over __fixtures__/result-stub.json.
//
// Two tests below hold the copy honest: it must measure every expectation
// baseline.json requires of its scenario, and it must not predate that baseline.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { nightGlyph, renderReport, summarizeRun } from "./report.mjs";
import { GLYPH_NA } from "./lib.mjs";

const FIXTURE = path.join(import.meta.dirname, "__fixtures__", "result-stub.json");
const recorded = JSON.parse(readFileSync(FIXTURE, "utf8"));
const BASELINE = JSON.parse(readFileSync(path.join(import.meta.dirname, "baseline.json"), "utf8"));

/** A run that failed in a phase and read almost nothing — the case the report
 *  must render without inventing a single number. */
const brokenRun = {
  scenario: { name: "kp-rung0" },
  runDir: "/bench/app-master/runs/2026-01-01T00-00-00-kp-rung0",
  mode: "keyless",
  personas: { stub: false },
  ok: false,
  failedPhase: "nights",
  specHighlights: {
    population: "agent",
    scopeRung: 0,
    budgetUsd: 40,
    probationDays: 14,
    forbiddenClasses: 6,
    objectives: ["gate_pass_rate"],
  },
  populationFit: { verdict: "unassessed" },
  nights: [{ night: 1, ms: 1200, reading: {}, backbone: null, appMaster: null, error: "404 no such route" }],
  probation: null,
  costReportedUsd: null,
  wallMs: 61_000,
  unmeasured: ["night 1: POST /api/kp/test/tick answered 404"],
  warnings: [],
  expectations: [
    { name: "maxProposalsOpened", ok: true, expected: "<= 0", actual: null, delta: "no night reported a proposal count", note: "unmeasured — an absent count is not a reported zero" },
    { name: "probation", ok: false, expected: "extended | retired", actual: null, delta: "the probation phase returned no decision" },
  ],
  errors: [{ phase: "nights", error: "the tick route answered 404" }],
};

test("the recorded fixture is a real driver result", () => {
  assert.equal(recorded.schemaVersion, 1);
  assert.equal(recorded.scenario.name, "kp-default");
  assert.equal(recorded.personas.stub, true, "the fixture came from the stub, and must say so");
  assert.ok(recorded.nights.length >= 1);
  assert.ok(recorded.phases.length >= 8, "every phase of the loop ran");
});

test("the fixture measures every expectation its scenario is baselined on", () => {
  // The check that would have caught the drift this fixture had accumulated: it
  // was recorded on 2026-08-24 and carried THREE expectations while kp-default's
  // baseline required four — `minProposalsOpened` had been added to the scenario
  // and the renderer was still being proven against a record that never measured
  // it. A fixture that pins fewer checks than the gate requires is a renderer
  // test with a hole in exactly the place the gate cares about.
  const spec = BASELINE.scenarios[recorded.scenario.name];
  assert.ok(spec, `the baseline no longer names ${recorded.scenario.name}, which this fixture records`);
  const measured = new Set((recorded.expectations ?? []).map((e) => e.name));
  for (const required of spec.requiredExpectations ?? []) {
    assert.ok(
      measured.has(required),
      `the fixture never measured "${required}", which baseline.json requires of ${recorded.scenario.name}. ` +
        `Regenerate it with the command in this file's header.`,
    );
  }
});

test("the fixture is not older than the baseline it is read beside", () => {
  // The same rule bench:gate applies to a run (gate.mjs): a record that predates
  // the bar it sits next to cannot speak for it. Deliberately NOT an absolute
  // age — a test that turns red on a calendar date teaches people to ignore it.
  const recordedAt = Date.parse(recorded.finishedAt);
  const baselineAt = Date.parse(`${BASELINE.recordedAt}T00:00:00.000Z`);
  assert.ok(Number.isFinite(recordedAt), `the fixture's finishedAt will not parse: ${recorded.finishedAt}`);
  assert.ok(
    recordedAt >= baselineAt,
    `the fixture was recorded ${recorded.finishedAt}, before baseline.json's ${BASELINE.recordedAt}. ` +
      `Regenerate it with the command in this file's header.`,
  );
});

test("summarizeRun reduces a run to the row the table carries", () => {
  const row = summarizeRun(recorded);
  assert.equal(row.name, "kp-default");
  assert.equal(row.stub, true);
  assert.equal(row.ok, recorded.ok, "the row carries the record's verdict, whichever way it went");
  assert.match(row.spec, /^rung 2 · \$120 · 30d · 6 forbidden · 2 objectives$/);
  assert.equal(row.nights.length, recorded.nights.length);
  assert.equal(typeof row.bestCoverage, "number");
});

test("nightGlyph: incomplete is a DASH, not a cross", () => {
  assert.equal(nightGlyph("pass"), "✓");
  assert.equal(nightGlyph("fail"), "✗");
  assert.equal(nightGlyph("incomplete"), GLYPH_NA);
  assert.equal(nightGlyph(null), GLYPH_NA);
});

test("the report leads with a verdict banner and the glyph legend", () => {
  const md = renderReport([recorded], { generatedAt: "2026-01-01T00:00:00.000Z" });
  const banner = md.split("\n").find((l) => l.startsWith("▌"));
  assert.ok(banner, "a lead banner is the eval-report convention");
  // Asserted against the RECORD, not against a wish: the current fixture fails
  // `probation` because run.mjs's probation reader handles only the array-shaped
  // tick summary and the stub answers the object-shaped one (see "Known gaps" in
  // docs/features/app-master/README.md). The pass side of the same arithmetic is
  // covered by "the banner counts a passing run as a pass" below, on a synthetic
  // row, so this stays honest without losing the green path.
  assert.match(banner, new RegExp(`${recorded.ok ? 1 : 0}/1 runs PASS`));
  assert.match(md, /Generated 2026-01-01T00:00:00\.000Z/);
  assert.match(md, /✓ pass · ✗ fail · – not measured/);
});

test("a stub run is marked as a stub, wherever it appears", () => {
  const md = renderReport([recorded], { generatedAt: "x" });
  assert.match(md, /against a STUB Personas/);
  assert.match(md, /Every number those rows carry is CANNED/);
  assert.match(md, /\| kp-default \*\(stub\)\* \|/);
});

test("a run that read nothing renders dashes and names the unmeasured lane", () => {
  const md = renderReport([brokenRun], { generatedAt: "x" });
  assert.match(md, /Failed in phase `nights`/);
  assert.match(md, /0\/1 runs PASS/);
  assert.match(md, /1 unmeasured lane\(s\)/);
  assert.match(md, /POST \/api\/kp\/test\/tick answered 404/);
  // The absent counters must not have become zeroes on the way to the table.
  const row = md.split("\n").find((l) => l.startsWith("| ✗ | kp-rung0"));
  assert.ok(row, "the failed run has a row");
  assert.ok(!/\| 0 \|/.test(row), `an unread counter rendered as 0: ${row}`);
  assert.ok(row.includes(`| ${GLYPH_NA} |`), "unread counters render as a dash");
});

test("an unmeasured expectation keeps its note in the table", () => {
  const md = renderReport([brokenRun], { generatedAt: "x" });
  assert.match(md, /not a reported zero/);
});

test("a cell containing a pipe cannot break the table", () => {
  const withPipe = structuredClone(brokenRun);
  withPipe.expectations[1].expected = "extended | retired";
  const md = renderReport([withPipe], { generatedAt: "x" });
  assert.match(md, /extended \\\| retired/);
});

test("no runs at all is said out loud, not rendered as an empty pass", () => {
  const md = renderReport([], { generatedAt: "x" });
  assert.match(md, /0\/0 runs PASS/);
  assert.match(md, /No runs found/);
});

// ─── build reliability (P6h) ────────────────────────────────────────────────

/** A run whose hire only stands because the build was re-dispatched once. */
const retriedRun = {
  ...brokenRun,
  scenario: { name: "kp-retried" },
  ok: true,
  failedPhase: null,
  errors: [],
  expectations: [],
  hire: {
    hiredAgentId: "agent-2",
    requestId: "req-2",
    buildAttempts: 2,
    buildFailures: [
      { attempt: 1, requestId: "req-1", hiredAgentId: "agent-1", terminal: "failed", ladder: ["onboarding", "failed"], reason: "promotion held: tools never called" },
    ],
  },
};

test("summarizeRun carries the build attempts, and an absent one is null — not one clean build", () => {
  assert.deepEqual(summarizeRun(retriedRun).buildAttempts, 2);
  assert.equal(summarizeRun(retriedRun).buildFailures.length, 1);
  assert.equal(summarizeRun(brokenRun).buildAttempts, null, "a run that never dispatched reports no attempts");
});

test("the banner reports build reliability, so a sweep cannot hide its flake rate", () => {
  const md = renderReport([retriedRun], { generatedAt: "x" });
  const banner = md.split("\n").find((l) => l.startsWith("▌"));
  assert.match(banner, /builds 1\/2 OK \(50% build reliability\)/);

  // Two runs, three builds, one dead → 2/3.
  const clean = { ...retriedRun, scenario: { name: "kp-clean" }, hire: { hiredAgentId: "a", requestId: "r", buildAttempts: 1, buildFailures: [] } };
  const both = renderReport([retriedRun, clean], { generatedAt: "x" }).split("\n").find((l) => l.startsWith("▌"));
  assert.match(both, /builds 2\/3 OK \(67% build reliability\)/);
});

test("a sweep where nothing reached a dispatch says so instead of claiming 100%", () => {
  const banner = renderReport([brokenRun], { generatedAt: "x" }).split("\n").find((l) => l.startsWith("▌"));
  assert.match(banner, new RegExp(`builds ${GLYPH_NA} \\(no run reached a dispatch\\)`));
});

test("the Builds column is attempts/failures, and the dead build keeps its reason", () => {
  const md = renderReport([retriedRun], { generatedAt: "x" });
  const row = md.split("\n").find((l) => l.startsWith("| ✓ | kp-retried"));
  assert.ok(row, "the retried run has a row");
  assert.ok(row.includes("| 2/1 |"), `the Builds cell reads attempts/failures: ${row}`);
  // The header carries the column, in the same position as the cell.
  const header = md.split("\n").find((l) => l.startsWith("| | Scenario |"));
  assert.equal(header.split("|").indexOf(" Builds "), row.split("|").findIndex((c) => c.trim() === "2/1"));
  // …and the failure itself is readable, not just counted.
  assert.match(md, /attempt 1 \(`req-1`\) ended `failed` — promotion held: tools never called/);
});

test("a run that never dispatched renders a dash in Builds", () => {
  const md = renderReport([brokenRun], { generatedAt: "x" });
  const row = md.split("\n").find((l) => l.startsWith("| ✗ | kp-rung0"));
  assert.ok(row.includes(`| ${GLYPH_NA} |`), "no attempt reported ⇒ a dash, never 0/0");
});

test("the report renders every recorded run, in the order given", () => {
  const md = renderReport([recorded, brokenRun], { generatedAt: "x" });
  assert.ok(md.indexOf("## kp-default") < md.indexOf("## kp-rung0"));
  assert.match(md, new RegExp(`${recorded.ok ? 1 : 0}/2 runs PASS`));
});

test("the banner counts a passing run as a pass", () => {
  // The green half of the arithmetic, on a synthetic row rather than on the
  // recorded fixture — so it keeps holding whatever the recorded run's verdict
  // happens to be on the day it was regenerated.
  const passing = { ...recorded, ok: true, expectations: (recorded.expectations ?? []).map((e) => ({ ...e, ok: true })) };
  const md = renderReport([passing, brokenRun], { generatedAt: "x" });
  assert.match(md, /1\/2 runs PASS/);
  assert.match(renderReport([passing], { generatedAt: "x" }), /1\/1 runs PASS/);
});
