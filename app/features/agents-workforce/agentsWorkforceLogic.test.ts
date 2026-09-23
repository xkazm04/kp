// Pure-function tests for the Agents workforce roster logic: the expectations
// verdict (metrics vs aggregates), the status → badge mapping, and the
// connector-chip summarization. Runner: node --test (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AgentAggregates, AgentStatus } from "@/app/_lib/db/agents.ts";
import type { ReportedKpiDelta } from "@/app/_lib/agent-hire/report-payload.ts";
import {
  BACKBONE_MARK,
  budgetFraction,
  expectationsVerdict,
  fmtUsd,
  isAppMaster,
  metricActual,
  MARK,
  METRIC_MARK,
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
    lastReportAt: null,
    lastDecision: null,
    pendingApprovalSince: null,
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

test("isAppMaster + every vocabulary resolves through the one shared ✓/–/✗ mark", () => {
  assert.equal(isAppMaster(rosterRow()), true);
  assert.equal(isAppMaster(rosterRow({ appMaster: null })), false);
  // One pair of values, spelled once. The glyph and its colour token travel
  // TOGETHER — they used to be separate maps, which is how a ✓ could end up
  // wearing the null colour (or a dash the strong one) with nothing to catch it.
  assert.deepEqual(MARK, {
    pass: { glyph: "✓", text: "text-score-strong" },
    unknown: { glyph: "–", text: "text-score-null" },
    fail: { glyph: "✗", text: "text-score-weak" },
  });
  // Both mapped vocabularies, and both send their "could not read it" state to
  // the DASH: the scorer reaching "incomplete" and a metric with no reading are
  // the same claim, and a checkmark on either is the green lie the rubric forbids.
  assert.deepEqual(BACKBONE_MARK, { pass: "pass", incomplete: "unknown", fail: "fail" });
  assert.deepEqual(METRIC_MARK, { met: "pass", missed: "fail", nodata: "unknown" });
  assert.equal(MARK[BACKBONE_MARK.incomplete].glyph, "–");
  assert.equal(MARK[METRIC_MARK.nodata].text, "text-score-null");
});

test("memoryChip renders live tiers only and stays silent with nothing reported", async () => {
  const { memoryChip } = await import("./agentsWorkforceLogic.ts");
  assert.equal(memoryChip(null), null);
  assert.equal(memoryChip({ core: 0, active: 0, working: 0, archived: 12 }), null, "archive-only is history, not a working mind");
  assert.equal(memoryChip({ core: 1, active: 4, working: 2, archived: 0 }), "1 core · 6 active");
});

// ---- Next move (challenge-r06 agents-api/B) ----------------------------------
// Every roster row carries ONE derived next move, and the tab counts them. The
// approval clock reads when the hire ENTERED pending_approval (the lifecycle
// row the transition door writes, projected as `pendingApprovalSince`), never
// `updatedAt`, which any later write can bump.

const H = 60 * 60 * 1000;
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * H).toISOString();
const PAIRED = { paired: true } as const;

test("nextAction: a pending approval counts down the 24h consent window from when it ENTERED pending_approval", async () => {
  const { nextAction } = await import("./agentsWorkforceLogic.ts");
  const pending = (since: string | null, updatedAt: string | null = null) =>
    rosterRow({ status: "pending_approval", pendingApprovalSince: since, updatedAt });
  assert.deepEqual(nextAction(pending(hoursAgo(20)), PAIRED, NOW), { kind: "approve_in_personas", hoursLeft: 4 });
  assert.deepEqual(nextAction(pending(hoursAgo(25)), PAIRED, NOW), { kind: "approval_lapsed" });
  // updated_at is NOT the clock: a row touched an hour ago that entered the
  // state 30h ago has lapsed all the same.
  assert.deepEqual(nextAction(pending(hoursAgo(30), hoursAgo(1)), PAIRED, NOW), { kind: "approval_lapsed" });
  // No entry stamp (a hire dispatched before the door wrote one) -> no clock at
  // all, rather than one invented from updated_at.
  assert.deepEqual(nextAction(pending(null, hoursAgo(30)), PAIRED, NOW), { kind: "approve_in_personas", hoursLeft: null });
});

test("nextAction: approval_lapsed's action is Refresh, and every move that implies a transition names a LEGAL one", async () => {
  const { NEXT_ACTION_CONTROL, NEXT_ACTION_TRANSITION, NEXT_ACTION_KINDS } = await import("./agentsWorkforceLogic.ts");
  const { canTransition } = await import("@/app/_lib/db/agents.ts");
  assert.equal(NEXT_ACTION_CONTROL.approval_lapsed, "refresh");
  assert.equal(NEXT_ACTION_CONTROL.approve_in_personas, "refresh");
  assert.equal(NEXT_ACTION_CONTROL.redispatch, "redispatch");
  assert.equal(NEXT_ACTION_CONTROL.repair_bridge, "integrations");
  assert.equal(NEXT_ACTION_CONTROL.none, null);
  for (const kind of NEXT_ACTION_KINDS) {
    const move = NEXT_ACTION_TRANSITION[kind];
    if (move) assert.ok(canTransition(move.from, move.to), `${kind}: ${move.from} -> ${move.to} must be in AGENT_TRANSITIONS`);
  }
  // A dead hire has no exits, so its move cannot be a transition of the row:
  // re-dispatch mints a NEW hire.
  assert.equal(NEXT_ACTION_TRANSITION.redispatch, null);
});

test("nextAction: a failed or rejected hire is re-dispatched from where it came from; a retired one needs nothing", async () => {
  const { nextAction } = await import("./agentsWorkforceLogic.ts");
  for (const status of ["failed", "rejected"] as const) {
    assert.deepEqual(
      nextAction(rosterRow({ status, jobId: "job-7", intakeId: null, appMaster: null }), PAIRED, NOW),
      { kind: "redispatch", target: { jobId: "job-7" } },
      `job ${status}`
    );
    assert.deepEqual(
      nextAction(rosterRow({ status, jobId: "", intakeId: "intake-1" }), PAIRED, NOW),
      { kind: "redispatch", target: { intakeId: "intake-1" } },
      `app master ${status}`
    );
  }
  assert.deepEqual(nextAction(rosterRow({ status: "retired" }), PAIRED, NOW), { kind: "none" });
});

test("nextAction: an unpaired bridge outranks every other move on a live row", async () => {
  const { nextAction } = await import("./agentsWorkforceLogic.ts");
  const unpaired = { paired: false };
  for (const row of [
    rosterRow({ status: "pending_approval", pendingApprovalSince: hoursAgo(30) }),
    rosterRow({ status: "pending_approval", pendingApprovalSince: hoursAgo(2) }),
    rosterRow({ status: "onboarding", createdAt: "2026-06-01T00:00:00.000Z" }),
    rosterRow({ status: "active", lastReportAt: null }),
    rosterRow({ status: "dispatched" }),
  ]) {
    assert.deepEqual(nextAction(row, unpaired, NOW), { kind: "repair_bridge" }, row.status);
  }
  // Retirement stays a decision, whatever the bridge says.
  assert.deepEqual(nextAction(rosterRow({ status: "retired" }), unpaired, NOW), { kind: "none" });
  // An unknown bridge (still loading) is not evidence of a dead one.
  assert.deepEqual(
    nextAction(rosterRow({ status: "active", lastReportAt: hoursAgo(1), aggregates: agg({ lastActivityAt: hoursAgo(1) }) }), null, NOW),
    { kind: "none" }
  );
});

test("nextAction: a due probation asks for review until a decision lands after the due day", async () => {
  const { nextAction } = await import("./agentsWorkforceLogic.ts");
  // Hired 2026-06-01 on a 30-day probation -> due 2026-07-01; NOW is 2026-08-04.
  const due = { status: "onboarding" as const, createdAt: "2026-06-01T00:00:00.000Z", lastReportAt: hoursAgo(1) };
  assert.deepEqual(nextAction(rosterRow({ ...due, lastDecision: null }), PAIRED, NOW), { kind: "review_probation" });
  const extended = nextAction(
    rosterRow({ ...due, lastDecision: { event: "probation_review:extended", at: "2026-07-03T00:00:00.000Z" } }),
    PAIRED,
    NOW
  );
  assert.notEqual(extended.kind, "review_probation", "a human already extended it after the window closed");
  // A decision from BEFORE the due day does not answer this review.
  assert.deepEqual(
    nextAction(rosterRow({ ...due, lastDecision: { event: "probation_review:extended", at: "2026-06-20T00:00:00.000Z" } }), PAIRED, NOW),
    { kind: "review_probation" }
  );
  // Not yet due -> nothing to review.
  assert.notEqual(nextAction(rosterRow({ status: "onboarding", lastReportAt: hoursAgo(1) }), PAIRED, NOW).kind, "review_probation");
});

test("nextAction: an active agent's reporter is checked, silent vs calling-but-refused", async () => {
  const { nextAction } = await import("./agentsWorkforceLogic.ts");
  assert.deepEqual(nextAction(rosterRow({ status: "active", lastReportAt: null }), PAIRED, NOW), { kind: "check_reporter", reason: "silent" });
  assert.deepEqual(
    nextAction(rosterRow({ status: "active", lastReportAt: hoursAgo(8 * 24), aggregates: agg({ lastActivityAt: hoursAgo(8 * 24) }) }), PAIRED, NOW),
    { kind: "check_reporter", reason: "silent" }
  );
  assert.deepEqual(
    nextAction(rosterRow({ status: "active", lastReportAt: hoursAgo(2), aggregates: agg({ lastActivityAt: null }) }), PAIRED, NOW),
    { kind: "check_reporter", reason: "reports_rejected" }
  );
  assert.deepEqual(
    nextAction(rosterRow({ status: "active", lastReportAt: hoursAgo(2), aggregates: agg({ lastActivityAt: hoursAgo(2) }) }), PAIRED, NOW),
    { kind: "none" }
  );
});

test("needsYou: per-kind counts in declared priority, 'none' excluded, empty when nothing needs you", async () => {
  const { needsYou, NEXT_ACTION_PRIORITY } = await import("./agentsWorkforceLogic.ts");
  assert.deepEqual(NEXT_ACTION_PRIORITY, [
    "repair_bridge",
    "approval_lapsed",
    "approve_in_personas",
    "review_probation",
    "check_reporter",
    "redispatch",
  ]);
  assert.deepEqual(needsYou([], PAIRED, NOW), []);
  assert.deepEqual(needsYou([rosterRow({ status: "retired" }), rosterRow({ status: "retired", id: "b" })], PAIRED, NOW), []);
  const roster = [
    rosterRow({ id: "a", status: "failed", jobId: "j1", intakeId: null }),
    rosterRow({ id: "b", status: "pending_approval", pendingApprovalSince: hoursAgo(20) }),
    rosterRow({ id: "c", status: "pending_approval", pendingApprovalSince: hoursAgo(10) }),
    rosterRow({ id: "d", status: "pending_approval", pendingApprovalSince: hoursAgo(26) }),
    rosterRow({ id: "e", status: "retired" }),
  ];
  assert.deepEqual(needsYou(roster, PAIRED, NOW), [
    { kind: "approval_lapsed", count: 1, soonestHoursLeft: null },
    { kind: "approve_in_personas", count: 2, soonestHoursLeft: 4 },
    { kind: "redispatch", count: 1, soonestHoursLeft: null },
  ]);
});
