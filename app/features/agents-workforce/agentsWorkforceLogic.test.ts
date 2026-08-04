// Pure-function tests for the Agents workforce roster logic: the expectations
// verdict (metrics vs aggregates), the status → badge mapping, and the
// connector-chip summarization. Runner: node --test (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AgentAggregates, AgentStatus } from "@/app/_lib/db/agents.ts";
import {
  budgetFraction,
  expectationsVerdict,
  fmtUsd,
  metricActual,
  metricsOf,
  STATUS_BADGE,
  topConnectors,
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

// The deterministic metric set agentfit.py emits (runs_per_week gte, success_rate
// gte %, monthly_cost_usd lte).
const METRICS = metricsOf([
  { key: "runs_per_week", label: "Completed runs per week", target: 5, unit: "runs", direction: "gte" },
  { key: "success_rate", label: "Run success rate", target: 90, unit: "%", direction: "gte" },
  { key: "monthly_cost_usd", label: "Monthly cost", target: 100, unit: "USD", direction: "lte" },
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
  // 20 runs over 2 weeks = 10/week (≥5 met); 95% success (≥90 met); $150 month
  // cost (≤100 missed).
  const a = agg({
    runs: 20,
    successes: 19,
    successRate: 0.95,
    monthCostUsd: 150,
    lastActivityAt: "2026-08-01T00:00:00Z",
  });
  const v = expectationsVerdict(METRICS, a, TWO_WEEKS_AGO, NOW);
  assert.equal(v.total, 3);
  assert.equal(v.met, 2);
  assert.deepEqual(
    v.rows.map((r) => r.state),
    ["met", "met", "missed"]
  );
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
  const a = agg({ runs: 14, successRate: 0.5, monthCostUsd: 42.5, lastActivityAt: "2026-08-01T00:00:00Z" });
  assert.equal(metricActual("success_rate", a, TWO_WEEKS_AGO, NOW), 50);
  assert.equal(metricActual("monthly_cost_usd", a, TWO_WEEKS_AGO, NOW), 42.5);
  assert.equal(metricActual("runs_per_week", a, TWO_WEEKS_AGO, NOW), 7); // 14 runs / 2 weeks
  assert.equal(metricActual("runs_total", a, TWO_WEEKS_AGO, NOW), 14);
  // An unmapped key is honestly null — no fabricated 0 that would read "missed".
  assert.equal(metricActual("tickets_resolved", a, TWO_WEEKS_AGO, NOW), null);
  // successRate null (no runs) stays null even when other signals exist.
  assert.equal(metricActual("success_rate", agg({ lastActivityAt: "x" }), TWO_WEEKS_AGO, NOW), null);
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
