// Handler-level coverage for the agent-candidate bridge routes against an
// ISOLATED throwaway DB (testing/unit-db.ts must stay the first project import;
// it also clears KP_OPERATOR_PASSWORD → open mode, and PERSONAS_BRIDGE_* so no
// dev-shell pairing leaks in):
//   POST /api/agents/report/[token] — token auth (unknown/retired → 404),
//     payload-shape 400s, exec_id idempotency, rollup accept, lifecycle
//     activated → pipeline Hired, workspace-from-token writes
//   POST /api/agents/dispatch — fit-spec gate, one live agent per job
//     (idempotent re-dispatch never re-POSTs to Personas), failure marking
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { POST as reportPost } from "./report/[token]/route.ts";
import { POST as dispatchPost } from "./dispatch/route.ts";
import {
  createHiredAgent,
  createPipelineEntry,
  getActiveHiredAgentForJob,
  getAgentAggregates,
  getHiredAgent,
  getPipelineEntry,
  saveAgentFitSpec,
  updateHiredAgentStatus,
} from "../../_lib/db.ts";
import { insertJob } from "../../_lib/job-ingest.ts";
import type { JobRecord } from "../../_lib/db/core.ts";

after(() => cleanupUnitDb());

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.PERSONAS_BRIDGE_URL;
  delete process.env.PERSONAS_BRIDGE_KEY;
});

const SPEC = { name: "Ledger Agent", mission: "m", systemPromptDraft: "s", connectors: ["gmail"], maxTurns: null };

function report(token: string, payload: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return reportPost(
    new NextRequest(`http://localhost/api/agents/report/${token}`, {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "content-type": "application/json", ...headers },
    }),
    { params: Promise.resolve({ token }) }
  );
}

test("report route: an unknown token 404s before anything is written", async () => {
  const r = await report("agrpt-does-not-exist", { kind: "execution", execId: "x", status: "success" });
  assert.equal(r.status, 404);
});

test("report route: a retired agent's token is indistinguishable from unknown", async () => {
  const agent = createHiredAgent({ jobId: "job-r0", jobTitle: "Role", spec: SPEC }, "ws-a");
  updateHiredAgentStatus(agent.id, "retired", {}, "ws-a");
  const r = await report(agent.reportToken, { kind: "execution", execId: "x", status: "success" });
  assert.equal(r.status, 404);
});

test("report route: shape errors are deterministic 400s (retryable, never claimed)", async () => {
  const agent = createHiredAgent({ jobId: "job-r1", jobTitle: "Role", spec: SPEC }, "ws-a");
  for (const bad of [
    { kind: "execution", status: "success" }, // no execId
    { kind: "execution", execId: "e", status: "meh" }, // bad status
    { kind: "rollup" }, // no period
    { kind: "lifecycle", event: "exploded" }, // unknown event
    { kind: "telemetry" }, // unknown kind
  ]) {
    const r = await report(agent.reportToken, bad);
    assert.equal(r.status, 400, `expected 400 for ${JSON.stringify(bad)}`);
  }
});

test("report route: executions are accepted once and deduped by exec_id; writes land in the TOKEN's workspace", async () => {
  const agent = createHiredAgent({ jobId: "job-r2", jobTitle: "Role", spec: SPEC }, "ws-b");
  const exec = { kind: "execution", execId: "run-1", costUsd: 0.25, tokensIn: 100, tokensOut: 20, status: "success", durationMs: 900, connectorUses: [{ connector: "gmail", calls: 2 }] };

  const first = await report(agent.reportToken, exec);
  assert.equal(first.status, 200);
  assert.equal(((await first.json()) as { result: string }).result, "accepted");

  // Same execId, different raw body (so the in-process body-hash claim passes)
  // → the DURABLE exec_id dedup answers duplicate.
  const replay = await report(agent.reportToken, { ...exec, durationMs: 901 });
  assert.equal(replay.status, 200);
  assert.equal(((await replay.json()) as { result: string }).result, "duplicate_ignored");

  const agg = getAgentAggregates(agent.id, "ws-b");
  assert.equal(agg.runs, 1, "one run despite the replay");
  assert.equal(agg.connectors.gmail, 2);
  assert.equal(getAgentAggregates(agent.id, "workspace").runs, 0, "nothing leaked into the default workspace");
});

test("report route: a rollup upserts and the lifecycle 'activated' moves the pipeline row to Hired", async () => {
  // Default workspace so the pipeline id scheme matches the dispatch-time entry.
  const agent = createHiredAgent({ jobId: "job-r3", jobTitle: "Role", spec: SPEC });
  const { entry } = createPipelineEntry({
    candidateId: `agent-${agent.id}`,
    candidateLabel: SPEC.name,
    jobId: "job-r3",
    jobTitle: "Role",
    stage: "Offer",
    sourceChannel: "agent-bridge",
  });
  assert.equal(entry.stage, "Offer");

  const rollup = await report(agent.reportToken, { kind: "rollup", period: "2026-07", runs: 8, successes: 8, failures: 0, costUsd: 1.5 });
  assert.equal(rollup.status, 200);

  const lifecycle = await report(agent.reportToken, { kind: "lifecycle", event: "activated", personaId: "p-9", personaName: "Ledger Runner" });
  assert.equal(lifecycle.status, 200);

  const updated = getHiredAgent(agent.id);
  assert.equal(updated?.status, "active");
  assert.equal(updated?.personaId, "p-9");
  assert.equal(getPipelineEntry(entry.id)?.stage, "Hired", "activation auto-moves the agent's pipeline row");
});

const job = (id: string, title: string): JobRecord => ({ id, title }) as unknown as JobRecord;

function dispatchReq(jobId: string): NextRequest {
  return new NextRequest("http://localhost/api/agents/dispatch", {
    method: "POST",
    body: JSON.stringify({ jobId }),
    headers: { "content-type": "application/json" },
  });
}

test("dispatch route: no fit spec → 409; with a spec it POSTs Personas ONCE and a re-dispatch reuses the live agent", async () => {
  insertJob(job("job-d1", "Dispatch Role"), undefined, "published");
  process.env.PERSONAS_BRIDGE_URL = "http://127.0.0.1:9420";
  process.env.PERSONAS_BRIDGE_KEY = "pk_unit_test";
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ requestId: "pr-42" }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const none = await dispatchPost(dispatchReq("job-d1"));
  assert.equal(none.status, 409, "dispatch requires a fit spec first");

  saveAgentFitSpec({ jobId: "job-d1", fit: { verdict: "temporary", coverage: [], coverageRatio: 0.5 }, spec: SPEC, budget: { suggestedMonthlyUsd: 40, rule: "2% of salary-band midpoint", salaryBandRef: "x" }, metrics: [], source: "llm" });

  const first = await dispatchPost(dispatchReq("job-d1"));
  assert.equal(first.status, 200);
  const firstBody = (await first.json()) as { hiredAgentId: string; requestId: string; status: string };
  assert.equal(firstBody.requestId, "pr-42");
  assert.equal(firstBody.status, "pending_approval");
  assert.equal(calls, 1);

  const again = await dispatchPost(dispatchReq("job-d1"));
  assert.equal(again.status, 200);
  const againBody = (await again.json()) as { hiredAgentId: string; existing?: boolean };
  assert.equal(againBody.existing, true, "a live agent for the job is reused");
  assert.equal(againBody.hiredAgentId, firstBody.hiredAgentId);
  assert.equal(calls, 1, "Personas is NOT re-POSTed on the idempotent path");

  // The agent entered the pipeline at Offer under the agent- candidate prefix.
  const entryId = `m-agent-${firstBody.hiredAgentId}-job-d1`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 90);
  assert.equal(getPipelineEntry(entryId)?.stage, "Offer");
  assert.equal(getPipelineEntry(entryId)?.sourceChannel, "agent-bridge");
});

test("dispatch route: a Personas failure marks the hire failed (and frees the job for a retry)", async () => {
  insertJob(job("job-d2", "Failing Role"), undefined, "published");
  process.env.PERSONAS_BRIDGE_URL = "http://127.0.0.1:9420";
  process.env.PERSONAS_BRIDGE_KEY = "pk_unit_test";
  globalThis.fetch = (async () => new Response("nope", { status: 500 })) as typeof fetch;

  saveAgentFitSpec({ jobId: "job-d2", fit: { verdict: "temporary", coverage: [], coverageRatio: 0.5 }, spec: SPEC, budget: { suggestedMonthlyUsd: null, rule: "2% of salary-band midpoint", salaryBandRef: "none" }, metrics: [], source: "deterministic" });

  const r = await dispatchPost(dispatchReq("job-d2"));
  assert.equal(r.status, 502);
  const body = (await r.json()) as { hiredAgentId: string };
  assert.equal(getHiredAgent(body.hiredAgentId)?.status, "failed");
  assert.equal(getActiveHiredAgentForJob("job-d2"), null, "a failed dispatch doesn't block a retry");
});
