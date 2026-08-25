// The aggregate report renderer, over a RECORDED run.
//
//   node --test scripts/app-master-bench/
//
// `__fixtures__/result-stub.json` is a real `result.json`, produced by
//   node scripts/app-master-bench/run.mjs --scenario kp-default \
//     --kp http://localhost:3103 --stub-personas
// against a throwaway keyless kp and the in-process stub Personas. It is
// committed because `bench/` is not: the runs a sweep writes are local
// artifacts, and a renderer test that depends on one would pass only on the
// machine that last ran the bench.
//
// Regenerate it by re-running that command and copying the run's result.json
// over this file — never by hand-editing it. The point of a recorded fixture is
// that the renderer is proven against the shape the driver actually writes.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { nightGlyph, renderReport, summarizeRun } from "./report.mjs";
import { GLYPH_NA } from "./lib.mjs";

const FIXTURE = path.join(import.meta.dirname, "__fixtures__", "result-stub.json");
const recorded = JSON.parse(readFileSync(FIXTURE, "utf8"));

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

test("summarizeRun reduces a run to the row the table carries", () => {
  const row = summarizeRun(recorded);
  assert.equal(row.name, "kp-default");
  assert.equal(row.stub, true);
  assert.equal(row.ok, true);
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
  assert.match(banner, /1\/1 runs PASS/);
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
  assert.match(md, /1\/2 runs PASS/);
});
