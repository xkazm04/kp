import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import {
  createHiredAgent,
  getActiveHiredAgentForJob,
  getAgentAggregates,
  getHiredAgent,
  getHiredAgentByReportToken,
  getLatestAgentFitSpec,
  listHiredAgents,
  recordAgentExecution,
  saveAgentFitSpec,
  updateHiredAgentStatus,
  upsertAgentRollup,
} from "./agents.ts";

after(() => cleanupUnitDb());

// Behavioral coverage for the agent-candidate bridge store: tenancy isolation on
// reads AND writes, latest-per-job spec resolution, execution idempotency by
// exec_id, rollup upsert-by-period, and the rollup-wins aggregate rule.

const FIT = { verdict: "unassessed", coverage: [], coverageRatio: 0 };
const SPEC = { name: "Test Agent", mission: "m", systemPromptDraft: "s", connectors: ["gmail"], maxTurns: null };
const BUDGET = { suggestedMonthlyUsd: 40, rule: "2% of salary-band midpoint", salaryBandRef: "40000–60000 CZK/month" };

test("agent_fit_specs: latest-per-job read is workspace-scoped", () => {
  saveAgentFitSpec({ jobId: "job-1", fit: FIT, spec: { ...SPEC, name: "old" }, budget: BUDGET, metrics: [], source: "deterministic" }, "ws-a");
  saveAgentFitSpec({ jobId: "job-1", fit: FIT, spec: { ...SPEC, name: "new" }, budget: BUDGET, metrics: [], source: "llm" }, "ws-a");
  saveAgentFitSpec({ jobId: "job-1", fit: FIT, spec: { ...SPEC, name: "other-team" }, budget: BUDGET, metrics: [], source: "llm" }, "ws-b");

  const a = getLatestAgentFitSpec("job-1", "ws-a");
  assert.equal((a?.spec as { name: string }).name, "new", "the newest row for the team wins");
  const b = getLatestAgentFitSpec("job-1", "ws-b");
  assert.equal((b?.spec as { name: string }).name, "other-team", "another team reads only its own artifact");
  assert.equal(getLatestAgentFitSpec("job-1", "ws-c"), null, "a team with no artifact reads none");
});

test("hired_agents: rows are team-scoped; the report token resolves cross-workspace but dies on retire", () => {
  const agent = createHiredAgent({ jobId: "job-2", jobTitle: "Role", spec: SPEC, budgetUsd: 40 }, "ws-a");
  assert.match(agent.reportToken, /^agrpt-/, "the report token is minted by randomToken (CSPRNG prefix)");

  assert.ok(getHiredAgent(agent.id, "ws-a"), "the owning team reads its agent");
  assert.equal(getHiredAgent(agent.id, "ws-b"), null, "another team cannot read it by id");
  assert.equal(listHiredAgents("ws-b").length, 0, "another team's roster stays empty");

  // The public receive-time lookup: token = capability, workspace rides the row.
  const byToken = getHiredAgentByReportToken(agent.reportToken);
  assert.equal(byToken?.id, agent.id);
  assert.equal(byToken?.workspaceId, "ws-a", "the token row carries the workspace every write scopes to");

  updateHiredAgentStatus(agent.id, "retired", {}, "ws-a");
  assert.equal(getHiredAgentByReportToken(agent.reportToken), null, "a retired agent's token is indistinguishable from unknown");
});

test("dispatch idempotency read: one live agent per job, terminal agents don't block a re-hire", () => {
  const agent = createHiredAgent({ jobId: "job-3", jobTitle: "Role", spec: SPEC }, "ws-a");
  assert.equal(getActiveHiredAgentForJob("job-3", "ws-a")?.id, agent.id);
  assert.equal(getActiveHiredAgentForJob("job-3", "ws-b"), null, "the live-agent read is team-scoped");
  updateHiredAgentStatus(agent.id, "rejected", {}, "ws-a");
  assert.equal(getActiveHiredAgentForJob("job-3", "ws-a"), null, "a rejected agent no longer counts as live");
});

test("agent_activity: executions are idempotent by exec_id; rollups upsert by period", () => {
  const agent = createHiredAgent({ jobId: "job-4", jobTitle: "Role", spec: SPEC }, "ws-a");

  const first = recordAgentExecution(agent.id, { execId: "run-1", costUsd: 0.5, status: "success" }, "ws-a");
  assert.equal(first.created, true);
  const replay = recordAgentExecution(agent.id, { execId: "run-1", costUsd: 0.5, status: "success" }, "ws-a");
  assert.equal(replay.created, false, "a replayed exec_id never double-counts");

  upsertAgentRollup(agent.id, { period: "2025-01", runs: 10, successes: 9, failures: 1, costUsd: 3 }, "ws-a");
  upsertAgentRollup(agent.id, { period: "2025-01", runs: 12, successes: 11, failures: 1, costUsd: 3.5 }, "ws-a");

  const agg = getAgentAggregates(agent.id, "ws-a");
  // 2025-01 has a rollup → the rollup's 12 runs; the execution (current month,
  // no rollup) adds 1.
  assert.equal(agg.runs, 13, "latest rollup wins for its period; event-sum months add on top");
  assert.equal(agg.successes, 12);
  assert.equal(agg.costUsd, 4, "rollup 3.5 + execution 0.5");
  assert.ok(agg.successRate && agg.successRate > 0.9);

  const other = getAgentAggregates(agent.id, "ws-b");
  assert.equal(other.runs, 0, "aggregates are workspace-scoped");
});

test("aggregates: a rollup for the execution's month supersedes the event-sums", () => {
  const agent = createHiredAgent({ jobId: "job-5", jobTitle: "Role", spec: SPEC }, "ws-a");
  const month = new Date().toISOString().slice(0, 7);
  recordAgentExecution(agent.id, { execId: "e1", costUsd: 1, status: "success" }, "ws-a");
  recordAgentExecution(agent.id, { execId: "e2", costUsd: 1, status: "failure" }, "ws-a");
  // Personas later sends the month's authoritative rollup — it replaces the sums.
  upsertAgentRollup(agent.id, { period: month, runs: 5, successes: 4, failures: 1, costUsd: 2.25 }, "ws-a");
  const agg = getAgentAggregates(agent.id, "ws-a");
  assert.equal(agg.runs, 5, "the rollup is authoritative for its month");
  assert.equal(agg.costUsd, 2.25);
  assert.equal(agg.monthCostUsd, 2.25);
});
