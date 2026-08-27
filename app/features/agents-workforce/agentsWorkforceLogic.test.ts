// Pure-function tests for the Agents workforce roster logic: the expectations
// verdict (metrics vs aggregates), the status → badge mapping, and the
// connector-chip summarization. Runner: node --test (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AgentAggregates, AgentStatus } from "@/app/_lib/db/agents.ts";
import type { ReportedKpiDelta } from "@/app/_lib/agent-hire/report-payload.ts";
import {
  BACKBONE_GLYPH,
  BACKBONE_TEXT,
  budgetFraction,
  expectationsVerdict,
  fmtUsd,
  isAppMaster,
  metricActual,
  metricsOf,
  probationCountdown,
  STATUS_BADGE,
  topConnectors,
  type AgentRosterEntry,
} from "./agentsWorkforceLogic.ts";

const NOW = new Date("2026-08-04T00:00:00Z");
const TWO_WEEKS_AGO = "2026-07-21T00:00:00.000Z";

function agg(partial: Partial<AgentAggregates> = {}): AgentAggregates {
  return {
    runs: 0,
    successes: 0,
    failures: 0,
    successRate: null,
    costUsd: 0,
    monthCostUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
    connectors: {},
    lastActivityAt: null,
    ...partial,
  };
}

// The metric set agentfit.py ACTUALLY emits (_deterministic_metrics): runs_per_week
// gte, success_rate gte %, and cost_per_task lte USD — a PER-TASK ceiling of
// suggestedMonthlyUsd / 20, not a monthly total. This fixture used to name a
// `monthly_cost_usd` key the transform never produces, so the shipped key's
// mapping was never exercised here at all.
const METRICS = metricsOf([
  { key: "runs_per_week", label: "Completed runs per week", target: 5, unit: "runs", direction: "gte" },
  { key: "success_rate", label: "Run success rate", target: 90, unit: "%", direction: "gte" },
  { key: "cost_per_task", label: "Cost per completed task", target: 2.17, unit: "USD", direction: "lte" },
]);

test("status → badge mapping is exhaustive over the AgentStatus union", () => {
  // Exhaustiveness is enforced at COMPILE time (STATUS_BADGE is a Record over
  // the AgentStatus union — a new status is a TS error until mapped); here we
  // pin the runtime shape without importing the sqlite-backed module.
  const statuses = Object.keys(STATUS_BADGE) as AgentStatus[];
  assert.equal(statuses.length, 7);
  for (const status of statuses) {
    const badge = STATUS_BADGE[status];
    assert.ok(badge.tone && badge.key, `${status} carries a tone and an i18n key`);
  }
  // Terminal errors read critical, the live end state positive.
  assert.equal(STATUS_BADGE.failed.tone, "critical");
  assert.equal(STATUS_BADGE.rejected.tone, "critical");
  assert.equal(STATUS_BADGE.active.tone, "positive");
});

test("expectationsVerdict: gte and lte directions both evaluate against actuals", () => {
  // 20 runs over 2 weeks = 10/week (≥5 met); 95% success (≥90 met); $12 of spend
  // over those 20 runs = $0.60 a task (≤ 2.17 met).
  const cheap = agg({
    runs: 20,
    successes: 19,
    successRate: 0.95,
    costUsd: 12,
    monthCostUsd: 12,
    lastActivityAt: "2026-08-01T00:00:00Z",
  });
  const v = expectationsVerdict(METRICS, cheap, TWO_WEEKS_AGO, NOW);
  assert.equal(v.total, 3);
  // Pre-fix this read 2/3: the per-task ceiling was compared against the MONTH's
  // total spend ($12 vs a $2.17/task target), so a busy, cheap agent was reported
  // as 5x over the cost it was hired at.
  assert.equal(v.met, 3);
  assert.deepEqual(
    v.rows.map((r) => r.state),
    ["met", "met", "met"]
  );

  // …and a genuinely expensive agent still misses that ceiling: $60 / 20 runs = $3.
  const pricey = expectationsVerdict(
    METRICS,
    { ...cheap, costUsd: 60, monthCostUsd: 60 },
    TWO_WEEKS_AGO,
    NOW
  );
  assert.equal(pricey.met, 2);
  assert.equal(pricey.rows[2].state, "missed");
  assert.equal(pricey.rows[2].actual, 3);
});

test("expectationsVerdict: no reported activity → every row is nodata, 0 met", () => {
  // A just-dispatched agent has all-zero aggregates; that must read as "no data
  // yet", never as "0 runs — every target missed".
  const v = expectationsVerdict(METRICS, agg(), TWO_WEEKS_AGO, NOW);
  assert.equal(v.hasData, false);
  assert.equal(v.met, 0);
  assert.ok(v.rows.every((r) => r.state === "nodata"));
});

test("metricActual maps the known key families and refuses the unknown", () => {
  const a = agg({ runs: 14, successRate: 0.5, costUsd: 42.5, monthCostUsd: 42.5, lastActivityAt: "2026-08-01T00:00:00Z" });
  assert.equal(metricActual("success_rate", a, TWO_WEEKS_AGO, NOW), 50);
  assert.equal(metricActual("monthly_cost_usd", a, TWO_WEEKS_AGO, NOW), 42.5);
  assert.equal(metricActual("runs_per_week", a, TWO_WEEKS_AGO, NOW), 7); // 14 runs / 2 weeks
  assert.equal(metricActual("runs_total", a, TWO_WEEKS_AGO, NOW), 14);
  // An unmapped key is honestly null — no fabricated 0 that would read "missed".
  assert.equal(metricActual("tickets_resolved", a, TWO_WEEKS_AGO, NOW), null);
  // successRate null (no runs) stays null even when other signals exist.
  assert.equal(metricActual("success_rate", agg({ lastActivityAt: "x" }), TWO_WEEKS_AGO, NOW), null);
});

test("metricActual: a per-unit cost target is a rate, and an uncosted ledger is no data", () => {
  const live = "2026-08-01T00:00:00Z";
  const a = agg({ runs: 20, costUsd: 12, monthCostUsd: 12, lastActivityAt: live });
  // cost_per_task is what agentfit.py ships: total spend ÷ runs, NOT the month's bill.
  assert.equal(metricActual("cost_per_task", a, TWO_WEEKS_AGO, NOW), 0.6);
  assert.equal(metricActual("cost_per_run", a, TWO_WEEKS_AGO, NOW), 0.6);
  // A period total still reads as the month's spend.
  assert.equal(metricActual("monthly_cost_usd", a, TWO_WEEKS_AGO, NOW), 12);

  // Spend the provider never costed (subscription auth reads $0 — the roster's own
  // spendNote says so) is "no data", never a ✓ against a ceiling: an agent that has
  // only reported a lifecycle event used to score its budget target as met.
  const uncosted = agg({ runs: 20, lastActivityAt: live });
  assert.equal(metricActual("cost_per_task", uncosted, TWO_WEEKS_AGO, NOW), null);
  assert.equal(metricActual("monthly_cost_usd", uncosted, TWO_WEEKS_AGO, NOW), null);
  assert.equal(
    expectationsVerdict(METRICS, agg({ lastActivityAt: live }), TWO_WEEKS_AGO, NOW).rows[2].state,
    "nodata",
    "an activated-but-idle agent has no cost verdict at all"
  );

  // A costed ledger with no runs cannot state a per-task rate either (guarded divisor).
  assert.equal(metricActual("cost_per_task", agg({ costUsd: 5, lastActivityAt: live }), TWO_WEEKS_AGO, NOW), null);
});

test("metricsOf drops malformed entries and defaults direction to gte", () => {
  const parsed = metricsOf([
    { key: "ok", label: "OK", target: 1, unit: "x", direction: "weird" },
    { key: "no_target", label: "bad" },
    "not-an-object",
    null,
  ]);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].direction, "gte");
  assert.equal(metricsOf(null).length, 0);
});

test("topConnectors returns the top 3 by calls with a +n remainder", () => {
  const s = topConnectors({ gmail: 5, slack: 9, jira: 2, github: 9, notion: 1 });
  // Ties (slack/github at 9) break alphabetically for a stable render.
  assert.deepEqual(
    s.top.map((c) => c.name),
    ["github", "slack", "gmail"]
  );
  assert.equal(s.more, 2);
  assert.deepEqual(topConnectors({}), { top: [], more: 0 });
});

test("budgetFraction caps at 1 and is null without a usable budget", () => {
  assert.equal(budgetFraction(50, 100), 0.5);
  assert.equal(budgetFraction(150, 100), 1);
  assert.equal(budgetFraction(10, null), null);
  assert.equal(budgetFraction(10, 0), null);
});

test("fmtUsd renders whole dollars without cents", () => {
  assert.equal(fmtUsd(120, "en"), "$120");
  assert.equal(fmtUsd(42.5, "en"), "$42.50");
});

// ---- App master ---------------------------------------------------------------

const OBJECTIVES = metricsOf([
  { key: "gate_green_rate", label: "Gates green", target: 0.95, unit: "ratio", direction: "gte" },
  { key: "p95_ttfb_ms", label: "p95 TTFB", target: 600, unit: "ms", direction: "lte" },
  { key: "open_bug_age_days", label: "Open bug age", target: 7, unit: "days", direction: "lte" },
]);

function delta(partial: Partial<ReportedKpiDelta> & { kpiKey: string }): ReportedKpiDelta {
  return {
    baseline: null,
    current: null,
    target: null,
    direction: "gte",
    windowDays: 30,
    measured: false,
    ...partial,
  };
}

test("expectationsVerdict: reported KPI deltas take over from the run/spend proxies", () => {
  // The aggregates say the agent is busy and cheap; the value ledger says two of
  // three objectives moved. An App master is hired against the LEDGER, and
  // scoring it on runs would answer a question nobody asked.
  const deltas: ReportedKpiDelta[] = [
    delta({ kpiKey: "gate_green_rate", baseline: 0.7, current: 0.96, target: 0.95, direction: "gte", measured: true }),
    delta({ kpiKey: "p95_ttfb_ms", baseline: 820, current: 610, target: 600, direction: "lte", measured: true }),
    // Reported, but nobody read the meter → a coverage gap, NOT a miss.
    delta({ kpiKey: "open_bug_age_days", target: 7, direction: "lte", measured: false }),
  ];
  const verdict = expectationsVerdict(OBJECTIVES, agg({ runs: 40, lastActivityAt: "2026-08-03T00:00:00.000Z" }), TWO_WEEKS_AGO, NOW, deltas);
  assert.equal(verdict.source, "kpiDeltas");
  assert.equal(verdict.met, 2);
  assert.equal(verdict.total, 3);
  assert.deepEqual(
    verdict.rows.map((r) => r.state),
    ["met", "met", "nodata"],
    "an unmeasured objective is a dash, never a ✗"
  );
  assert.equal(verdict.rows[1].actual, 610, "the reading shown is the KPI's own, not a run count");
});

test("expectationsVerdict: an objective with no delta at all reads nodata, and no deltas falls back", () => {
  const partial = expectationsVerdict(OBJECTIVES, agg({ lastActivityAt: "2026-08-03T00:00:00.000Z" }), TWO_WEEKS_AGO, NOW, [
    delta({ kpiKey: "gate_green_rate", baseline: 0.7, current: 0.5, target: 0.95, direction: "gte", measured: true }),
  ]);
  assert.equal(partial.source, "kpiDeltas");
  assert.deepEqual(
    partial.rows.map((r) => r.state),
    ["missed", "nodata", "nodata"],
    "objectives the reporter never mentioned are unread, not failed"
  );

  // No deltas (a task agent, or a pre-v2 reporter) → today's aggregate mapping.
  assert.equal(expectationsVerdict(METRICS, agg({ lastActivityAt: "2026-08-03T00:00:00.000Z" }), TWO_WEEKS_AGO, NOW, null).source, "aggregates");
  assert.equal(expectationsVerdict(METRICS, agg({ lastActivityAt: "2026-08-03T00:00:00.000Z" }), TWO_WEEKS_AGO, NOW, []).source, "aggregates");
});

function rosterRow(partial: Partial<AgentRosterEntry> = {}): AgentRosterEntry {
  return {
    id: "agent-1",
    workspaceId: "workspace",
    jobId: "",
    jobTitle: "App master",
    intakeId: "intake-1",
    appMaster: { population: "agent", scopeRung: 2, probationDays: 30, autopilotMode: "suggest", memory: null },
    personaId: null,
    personaName: null,
    requestId: "pr-1",
    status: "onboarding",
    spec: null,
    fit: null,
    metrics: null,
    budgetUsd: 120,
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: null,
    aggregates: agg(),
    backbone: null,
    kpiDeltas: null,
    ...partial,
  };
}

test("probationCountdown: counts down while the agent is still on probation, and stops once a human has decided", () => {
  // Hired 14 days before NOW, on a 30-day probation.
  const running = probationCountdown(rosterRow(), NOW);
  assert.deepEqual(running, { totalDays: 30, elapsedDays: 14, daysLeft: 16, due: false });

  // Past the window and still in onboarding → the review is DUE and says so.
  const overdue = probationCountdown(rosterRow({ createdAt: "2026-06-01T00:00:00.000Z" }), NOW);
  assert.equal(overdue?.daysLeft, 0);
  assert.equal(overdue?.due, true);

  // A human already decided (activated / retired / rejected) — nothing to count.
  for (const status of ["active", "retired", "rejected", "failed"] as const) {
    assert.equal(probationCountdown(rosterRow({ status }), NOW), null, status);
  }
  // Not an App master, or no probation window on the spec.
  assert.equal(probationCountdown(rosterRow({ appMaster: null }), NOW), null);
  assert.equal(
    probationCountdown(rosterRow({ appMaster: { population: "agent", scopeRung: 2, probationDays: null, autopilotMode: null, memory: null } }), NOW),
    null
  );
});

test("isAppMaster + the backbone glyphs follow the shared ✓/–/✗ convention", () => {
  assert.equal(isAppMaster(rosterRow()), true);
  assert.equal(isAppMaster(rosterRow({ appMaster: null })), false);
  // `incomplete` is a DASH, not a soft ✓: the scorer could not read enough to
  // judge, and a checkmark there is exactly the green lie the rubric forbids.
  assert.deepEqual(BACKBONE_GLYPH, { pass: "✓", incomplete: "–", fail: "✗" });
  assert.equal(BACKBONE_TEXT.incomplete, "text-score-null");
});

test("memoryChip renders live tiers only and stays silent with nothing reported", async () => {
  const { memoryChip } = await import("./agentsWorkforceLogic.ts");
  assert.equal(memoryChip(null), null);
  assert.equal(memoryChip({ core: 0, active: 0, working: 0, archived: 12 }), null, "archive-only is history, not a working mind");
  assert.equal(memoryChip({ core: 1, active: 4, working: 2, archived: 0 }), "1 core · 6 active");
});
