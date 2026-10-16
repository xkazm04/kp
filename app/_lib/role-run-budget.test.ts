// The per-run LLM ceiling (ADR-0011): a run whose own llm_usage rows have reached the
// ceiling PARKS before the next stage - zero artifacts, an explicit `budgetExceeded`, no
// crash - and a run under it is unaffected. Real DB, real ledger rows; the only injected
// thing is the stage runner that "makes an LLM call" (by metering one row), so no CLI is
// ever spawned.
import "better-sqlite3";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { advanceRoleRun, type StageRunner } from "./role-run-engine.ts";
import { getOrCreateRoleRun, listStageArtifacts } from "./db/role-runs.ts";
import { ensureDb } from "./db/core.ts";
import { insertLlmUsage, sumRoleRunUsage } from "./db/llm.ts";
import { insertJob } from "./job-ingest.ts";
import { createPipelineEntry } from "./db/pipeline.ts";
import type { JobRecord } from "./db/core.ts";
import { budgetBreach, resolveRoleRunBudget, type RoleRunBudget } from "./role-run-budget.ts";

before(() => {
  ensureDb();
  for (const id of ["jd-budget-a", "jd-budget-b", "jd-budget-c"]) {
    insertJob({ id, title: "Engineer", requirements: [{ skill: "java", kind: "skill", hardness: "must" }] } as unknown as JobRecord, undefined, "published");
  }
});
after(() => cleanupUnitDb());

const meter = (roleRunId: string | null, tokens = 100, costUsd: number | null = null) =>
  insertLlmUsage({ useCase: "role_run_test", provider: "claude_cli", source: "llm", outcome: "ok", inputTokens: tokens, outputTokens: 0, costUsd, roleRunId });

test("budgetBreach: reaching a ceiling counts (>=), unknown cost is never compared, null ceilings are off", () => {
  const none: RoleRunBudget = { maxCalls: null, maxTokens: null, maxCostUsd: null };
  const usage = { calls: 5, tokens: 1000, costUsd: null, unpricedCalls: 5 };
  assert.equal(budgetBreach(usage, none), null);
  assert.deepEqual(budgetBreach(usage, { ...none, maxCalls: 5 }), { dimension: "calls", used: 5, ceiling: 5 });
  assert.equal(budgetBreach(usage, { ...none, maxCalls: 6 }), null);
  assert.deepEqual(budgetBreach(usage, { ...none, maxTokens: 1000 }), { dimension: "tokens", used: 1000, ceiling: 1000 });
  assert.equal(budgetBreach(usage, { ...none, maxCostUsd: 0.01 }), null, "unpriced spend is not converted into dollars");
  assert.deepEqual(budgetBreach({ ...usage, costUsd: 2 }, { ...none, maxCostUsd: 1.5 }), { dimension: "cost_usd", used: 2, ceiling: 1.5 });
});

test("resolveRoleRunBudget: defaults, env overrides, and a typo falls back instead of removing the guard", () => {
  const saved = { ...process.env };
  try {
    delete process.env.KP_ROLE_RUN_MAX_LLM_CALLS;
    delete process.env.KP_ROLE_RUN_MAX_LLM_TOKENS;
    delete process.env.KP_ROLE_RUN_MAX_COST_USD;
    assert.deepEqual(resolveRoleRunBudget(), { maxCalls: 400, maxTokens: 4_000_000, maxCostUsd: null });
    process.env.KP_ROLE_RUN_MAX_LLM_CALLS = "12";
    process.env.KP_ROLE_RUN_MAX_LLM_TOKENS = "banana";
    process.env.KP_ROLE_RUN_MAX_COST_USD = "3.5";
    assert.deepEqual(resolveRoleRunBudget(), { maxCalls: 12, maxTokens: 4_000_000, maxCostUsd: 3.5 });
  } finally {
    process.env = saved;
  }
});

test("sumRoleRunUsage counts only this run's LLM rows; cost sums priced calls and counts the unpriced", () => {
  const { run } = getOrCreateRoleRun({ jobId: "jd-budget-a" });
  meter(run.id, 100, null);
  meter(run.id, 50, 0.25);
  meter(null, 999);
  meter("some-other-run", 999);
  insertLlmUsage({ useCase: "role_run_test", provider: "deterministic", source: "deterministic", outcome: "ok", roleRunId: run.id });
  assert.deepEqual(sumRoleRunUsage(run.id), { calls: 2, tokens: 150, costUsd: 0.25, unpricedCalls: 1 });
});

test("a run already over its ceiling produces zero artifacts and reports budgetExceeded (no throw)", async () => {
  seedCandidates("jd-budget-b", 2);
  const { run } = getOrCreateRoleRun({ jobId: "jd-budget-b" });
  meter(run.id);
  meter(run.id);
  const result = await advanceRoleRun(run.id, { budget: { maxCalls: 2, maxTokens: null, maxCostUsd: null } });
  assert.deepEqual(result.budgetExceeded, { dimension: "calls", used: 2, ceiling: 2 });
  assert.equal(result.produced.length, 0);
  assert.equal(listStageArtifacts(run.id).length, 0);
  assert.equal(result.status, "running", "parked, not cancelled: raising the ceiling resumes the run");

  // Same run, ceiling raised: it picks up exactly where it stood.
  const resumed = await advanceRoleRun(run.id, { budget: { maxCalls: 50, maxTokens: null, maxCostUsd: null } });
  assert.equal(resumed.budgetExceeded, null);
  assert.ok(resumed.produced.length > 0);
});

test("positive control: a run under the ceiling is unaffected", async () => {
  seedCandidates("jd-budget-c", 2);
  const { run } = getOrCreateRoleRun({ jobId: "jd-budget-c" });
  meter(run.id);
  const result = await advanceRoleRun(run.id, { budget: { maxCalls: 400, maxTokens: null, maxCostUsd: null } });
  assert.equal(result.budgetExceeded, null);
  assert.ok(result.produced.length >= 2);
});

test("a stage's own metered calls (ambient attribution) stop the NEXT stage, never the one running", async () => {
  seedCandidates("jd-budget-d", 3);
  const { run } = getOrCreateRoleRun({ jobId: "jd-budget-d" });
  // A stand-in producer: makes two metered "LLM calls" with NO explicit run id - the
  // engine's ambient scope must attribute them.
  const spendy: StageRunner = (ctx) => {
    insertLlmUsage({ useCase: "role_run_test", provider: "claude_cli", source: "llm", outcome: "ok", inputTokens: 10, outputTokens: 5 });
    insertLlmUsage({ useCase: "role_run_test", provider: "claude_cli", source: "llm", outcome: "ok", inputTokens: 10, outputTokens: 5 });
    return { status: "complete", payload: { jobId: ctx.run.jobId, roleSpecHash: "h", rubricVersion: "1", rubricKeys: ["java"], lintFindings: [] } };
  };
  const result = await advanceRoleRun(run.id, { runners: { role_spec: spendy }, budget: { maxCalls: 2, maxTokens: null, maxCostUsd: null } });
  assert.deepEqual(result.produced.map((p) => p.kind), ["role_spec"], "the stage that spent finished and wrote its artifact");
  assert.equal(result.budgetExceeded?.dimension, "calls");
  assert.deepEqual(sumRoleRunUsage(run.id), { calls: 2, tokens: 30, costUsd: null, unpricedCalls: 2 });
});

function seedCandidates(jobId: string, n: number): void {
  if (jobId === "jd-budget-d") insertJob({ id: jobId, title: "Engineer", requirements: [{ skill: "java", kind: "skill", hardness: "must" }] } as unknown as JobRecord, undefined, "published");
  for (let i = 0; i < n; i++) {
    createPipelineEntry({ candidateId: `${jobId}-c${i}`, candidateLabel: `Candidate ${i}`, jobId, jobTitle: "Engineer", matchScore: 80 });
  }
}
