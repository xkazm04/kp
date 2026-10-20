// challenge-r06 analytics-computation/A — the ONE cohort fold both sides of every period
// delta go through, and the ONE window derivation both reads bound themselves by.
//
// Pure cases (no DB): the half-open window pair, the as-of hire rule, the reach and
// time-to-hire sample the delta gates read. The store-level cases (the live payload is
// unchanged, the prior source read is bounded, the prior slice is age-matched) live in
// db/analytics-prior-slice.test.ts, beside the DB harness.
//
// Runner: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DAY_MS, deltaWindows, foldCohort, foldSources, windowStart, type CohortRow } from "./analytics-cohort.ts";
import { DEFAULT_STAGE_AXIS } from "./pipeline-stages.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const NOW = Date.parse("2026-09-23T12:00:00.000Z");
const ago = (days: number) => new Date(NOW - days * DAY_MS).toISOString();

function row(stage: string, createdDaysAgo: number, changedDaysAgo: number | null, extra: Partial<CohortRow> = {}): CohortRow {
  return {
    stage,
    status: stage === "Hired" ? "hired" : "active",
    created_at: ago(createdDaysAgo),
    stage_changed_at: changedDaysAgo == null ? null : ago(changedDaysAgo),
    source_channel: null,
    ...extra,
  };
}

test("deltaWindows: two half-open windows that TILE — the prior end IS the current start", () => {
  const w = deltaWindows(NOW, 30);
  assert.deepEqual(w.current, { start: NOW - 30 * DAY_MS, endExclusive: NOW });
  assert.deepEqual(w.prior, { start: NOW - 60 * DAY_MS, endExclusive: NOW - 30 * DAY_MS });
  // The same number, not a recomputation that happens to agree.
  assert.equal(Object.is(w.prior.endExclusive, w.current.start), true);
  // And windowStart is the one arithmetic both reads use for their lower bound.
  assert.equal(windowStart(w.prior.endExclusive, 30), w.prior.start);
  assert.equal(windowStart(NOW, 30), w.current.start);
});

test("age-matched: a hire that landed AFTER the prior window closed is not a prior-window hire", () => {
  const priorEnd = NOW - 30 * DAY_MS;
  // Created 40 days ago (inside [now-60d, now-30d)), moved to the terminal stage 20 days ago.
  const late = foldCohort([row("Hired", 40, 20)], DEFAULT_STAGE_AXIS, { asOfMs: priorEnd });
  assert.equal(late.total, 1);
  assert.equal(late.hired, 0, "hired after the window closed: not hired as of the window end");
  assert.equal(late.timeToHireSamples, 0, "and excluded from the prior time-to-hire sample");
  assert.equal(late.avgTimeToHireDays, null);
  // The terminal leg of the funnel agrees with the hire count.
  const terminal = late.funnel.find((f) => f.stage === "Hired")!;
  assert.equal(terminal.reached, 0);

  // The same entry hired 35 days ago — before the window end — IS a prior hire.
  const early = foldCohort([row("Hired", 40, 35)], DEFAULT_STAGE_AXIS, { asOfMs: priorEnd });
  assert.equal(early.hired, 1);
  assert.equal(early.timeToHireSamples, 1);
  assert.equal(early.avgTimeToHireDays, 5);
});

test("as of now, the fold is the historical one: every terminal row is a hire", () => {
  const rows = [row("Hired", 20, 5), row("Hired", 25, null), row("Interview", 10, 10), row("Accepted", 3, 3)];
  const f = foldCohort(rows, DEFAULT_STAGE_AXIS, { asOfMs: NOW });
  assert.equal(f.total, 4);
  // A terminal row with no transition stamp is still a hire (seeded straight onto the
  // column) — it just cannot join the time-to-hire sample.
  assert.equal(f.hired, 2);
  assert.equal(f.timeToHireSamples, 1);
  assert.equal(f.avgTimeToHireDays, 15);
  assert.deepEqual(
    f.funnel.map((s) => [s.stage, s.reached]),
    DEFAULT_STAGE_AXIS.map((s) => [s.id, s.id === "Accepted" ? 4 : s.id === "Screened" || s.id === "Interview" ? 3 : 2])
  );
  const interview = f.funnel.find((s) => s.stage === "Interview")!;
  assert.equal(interview.conversionPct, 100);
  assert.equal(f.funnel[0].conversionPct, null, "the entry stage has no upstream to convert from");
});

test("foldSources buckets by earliest-event origin with the same as-of hire rule", () => {
  const priorEnd = NOW - 30 * DAY_MS;
  const src = foldSources(
    [
      { stage: "Hired", kind: "applied", stage_changed_at: ago(20) },
      { stage: "Hired", kind: "applied", stage_changed_at: ago(35) },
      { stage: "Screened", kind: "intake_degraded", stage_changed_at: ago(40) },
    ],
    DEFAULT_STAGE_AXIS,
    { asOfMs: priorEnd }
  );
  assert.deepEqual(
    src.map((s) => [s.source, s.total, s.hired, s.hireRatePct]),
    [
      ["applied", 2, 1, 50],
      ["added", 1, 0, 0],
    ]
  );
});

test("GET /api/analytics reads the clock ONCE and bounds both reads from deltaWindows", () => {
  const route = readFileSync(resolve(HERE, "../api/analytics/route.ts"), "utf8");
  const live = route.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal((live.match(/Date\.now\(\)/g) ?? []).length, 1, "one captured `now` per request — a second Date.now() is a second boundary");
  assert.match(live, /deltaWindows\(/, "the window pair comes from the one helper");
  assert.match(live, /nowMs/, "the live read is pinned to the captured clock");
  assert.match(live, /\.prior\.endExclusive/, "the prior read ends where the current window starts");
  // The defect this replaces: an independently recomputed prior end.
  assert.doesNotMatch(live, /Date\.now\(\)\s*-\s*windowDays/, "the prior end must not be recomputed from a fresh clock");
});
