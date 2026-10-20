// The live role-run driver (role-run-live.ts) and its doors (POST /api/role-runs, POST
// /api/role-runs/[id]/advance). Real DB, real ledger; every stage runner that could call a
// model is INJECTED, so no CLI is ever spawned: the driver is proven to (a) advance to the
// first human gate and stop, (b) park on the LLM budget, (c) stay keyless under
// KP_ROLE_RUN_LLM=0, (d) never run one run twice at once, (e) refuse another team's run id.
import "better-sqlite3";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { ensureDb } from "./db/core.ts";
import type { JobRecord } from "./db/core.ts";
import { insertJob } from "./job-ingest.ts";
import { createPipelineEntry } from "./db/pipeline.ts";
import { DEFAULT_WORKSPACE_ID, createWorkspace } from "./db/workspaces.ts";
import { getOrCreateRoleRun, getRoleRun, listStageArtifacts } from "./db/role-runs.ts";
import type { StageRunners } from "./role-run-engine.ts";
import { advanceRoleRunLive, liveRoleRunRunners, tickRoleRuns } from "./role-run-live.ts";
import { roleRunLlmAvailable } from "./role-run-producers/index.ts";
import { POST as startRun } from "../api/role-runs/route.ts";
import { POST as advanceRun } from "../api/role-runs/[id]/advance/route.ts";

let n = 0;
/** A job with one board candidate and a fresh run for it. */
function seedRun(opts: { requirements?: boolean } = {}) {
  n += 1;
  const jobId = `jd-live-${n}`;
  insertJob(
    {
      id: jobId,
      title: "Live Role",
      description: "Build and run services for a small team.",
      requirements: opts.requirements === false ? [] : [{ skill: "java", kind: "skill", hardness: "must" }],
    } as unknown as JobRecord,
    undefined,
    "published"
  );
  const { entry } = createPipelineEntry({ candidateId: `live-cand-${n}`, candidateLabel: `Live ${n}`, jobId, jobTitle: "Live Role", matchScore: 90 });
  const { run } = getOrCreateRoleRun({ jobId });
  return { jobId, runId: run.id, branchRef: entry.id };
}

before(() => ensureDb());
after(() => cleanupUnitDb());

test("a live pass advances to the first human gate and stops there", async () => {
  const { runId, branchRef } = seedRun();
  const r = await advanceRoleRunLive(runId, DEFAULT_WORKSPACE_ID, { runners: {} });
  assert.equal(r.outcome, "advanced");
  if (r.outcome !== "advanced") return;
  assert.deepEqual(r.result.produced.map((p) => p.kind), ["role_spec", "slate", "screen"]);
  assert.deepEqual(r.result.awaiting, [{ branchRef, gate: "rejection" }], "parked at the Art. 22 gate");
  const before = listStageArtifacts(runId).length;
  const again = await advanceRoleRunLive(runId, DEFAULT_WORKSPACE_ID, { runners: {} });
  assert.equal(again.outcome === "advanced" && again.result.produced.length, 0, "a parked run produces nothing more");
  assert.equal(listStageArtifacts(runId).length, before);
});

test("the injected runners are the ones the pass uses", async () => {
  const { runId } = seedRun();
  const calls: string[] = [];
  const runners: Partial<StageRunners> = {
    role_spec: (ctx) => {
      calls.push(ctx.kind);
      return { status: "complete", payload: { jobId: ctx.run.jobId, roleSpecHash: "h", rubricVersion: "1", rubricKeys: ["x"], lintFindings: [] } };
    },
  };
  await advanceRoleRunLive(runId, DEFAULT_WORKSPACE_ID, { runners });
  assert.deepEqual(calls, ["role_spec"]);
});

test("a run over its LLM budget parks: no stage starts, the run stays running", async () => {
  const { runId } = seedRun();
  const r = await advanceRoleRunLive(runId, DEFAULT_WORKSPACE_ID, {
    runners: {},
    budget: { maxCalls: 3, maxTokens: null, maxCostUsd: null },
    readUsage: () => ({ calls: 3, tokens: 0, costUsd: null, unpricedCalls: 0 }),
  });
  assert.equal(r.outcome, "advanced");
  if (r.outcome !== "advanced") return;
  assert.deepEqual(r.result.budgetExceeded, { dimension: "calls", used: 3, ceiling: 3 });
  assert.equal(r.result.produced.length, 0);
  assert.equal(r.result.status, "running");
});

test("KP_ROLE_RUN_LLM=0 keeps the default live runners keyless", async () => {
  const saved = process.env.KP_ROLE_RUN_LLM;
  process.env.KP_ROLE_RUN_LLM = "0";
  try {
    assert.equal(roleRunLlmAvailable(), false);
    // No stated requirements + a description: with the LLM on, S0 would design a rubric
    // through the model. Off, it is the keyless floor's honest "no graded requirements".
    const { runId } = seedRun({ requirements: false });
    const r = await advanceRoleRunLive(runId, DEFAULT_WORKSPACE_ID, { runners: liveRoleRunRunners() });
    assert.equal(r.outcome, "advanced");
    const spec = listStageArtifacts(runId).find((a) => a.kind === "role_spec");
    assert.deepEqual((spec?.payload as { lintFindings: string[] }).lintFindings, ["no_graded_requirements"]);
  } finally {
    if (saved === undefined) delete process.env.KP_ROLE_RUN_LLM;
    else process.env.KP_ROLE_RUN_LLM = saved;
  }
});

test("two triggers cannot advance one run at once: the second is told busy", async () => {
  const { runId } = seedRun();
  let release!: () => void;
  const gate = new Promise<void>((res) => (release = res));
  let entered!: () => void;
  const inside = new Promise<void>((res) => (entered = res));
  const runners: Partial<StageRunners> = {
    role_spec: async (ctx) => {
      entered();
      await gate;
      return { status: "complete", payload: { jobId: ctx.run.jobId, roleSpecHash: "h", rubricVersion: "1", rubricKeys: [], lintFindings: [] } };
    },
  };
  const first = advanceRoleRunLive(runId, DEFAULT_WORKSPACE_ID, { runners });
  await inside;
  const second = await advanceRoleRunLive(runId, DEFAULT_WORKSPACE_ID, { runners });
  assert.deepEqual(second, { outcome: "busy" });
  release();
  assert.equal((await first).outcome, "advanced");
  assert.equal(listStageArtifacts(runId).filter((a) => a.kind === "role_spec").length, 1, "exactly one S0 artifact");
});

test("another team's run id is refused and nothing is written", async () => {
  const { runId } = seedRun();
  const other = createWorkspace("Other team");
  assert.deepEqual(await advanceRoleRunLive(runId, other.id, { runners: {} }), { outcome: "not_found" });
  assert.equal(listStageArtifacts(runId).length, 0);
  assert.equal(getRoleRun(runId, other.id), null);
});

test("the clock tick advances running runs to their gates and is a no-op afterwards", async () => {
  const { runId } = seedRun();
  const first = await tickRoleRuns({ runners: {} });
  assert.ok(first.produced >= 3);
  assert.ok(listStageArtifacts(runId).some((a) => a.kind === "screen" && a.status === "awaiting_approval"));
  const second = await tickRoleRuns({ runners: {} });
  assert.equal(second.produced, 0);
  assert.equal(second.failed, 0);
});

// --- The doors (open mode, default workspace) -------------------------------------

const post = (url: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

test("POST /api/role-runs: missing job is 400, unknown job is 404", async () => {
  assert.equal((await startRun(post("/api/role-runs", {}))).status, 400);
  const res = await startRun(post("/api/role-runs", { jobId: "no-such-job" }));
  assert.equal(res.status, 404);
  assert.equal((await res.json()).code, "ROLE_RUN_JOB_NOT_FOUND");
});

test("POST /api/role-runs/[id]/advance: an unknown run id is 404", async () => {
  const res = await advanceRun(post("/api/role-runs/nope/advance", {}), { params: Promise.resolve({ id: "nope" }) });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).code, "ROLE_RUN_NOT_FOUND");
});
