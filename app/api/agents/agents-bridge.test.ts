// Handler-level coverage for the agent-candidate bridge routes against an
// ISOLATED throwaway DB (testing/unit-db.ts must stay the first project import;
// it also clears KP_OPERATOR_PASSWORD → open mode, and PERSONAS_BRIDGE_* so no
// dev-shell pairing leaks in):
//   POST /api/agents/report/[token] — token auth (unknown/retired → 404),
//     payload-shape 400s, exec_id idempotency, rollup accept, lifecycle
//     activated → pipeline Hired, workspace-from-token writes
//   POST /api/agents/dispatch — fit-spec gate, one live agent per job
//     (idempotent re-dispatch never re-POSTs to Personas), failure marking and
//     no phantom board card when the dispatch fails
//   POST /api/agents/[id]/refresh — the safe wire projection (no report token)
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { POST as reportPost } from "./report/[token]/route.ts";
import { POST as dispatchPost } from "./dispatch/route.ts";
import { POST as refreshPost } from "./[id]/refresh/route.ts";
import {
  createHiredAgent,
  createPipelineEntry,
  getActiveHiredAgentForIntake,
  getActiveHiredAgentForJob,
  getAgentAggregates,
  getHiredAgent,
  getLatestAgentRollupRaw,
  getPipelineEntry,
  saveAgentFitSpec,
  updateHiredAgentStatus,
} from "../../_lib/db.ts";
import { createIntake, updateIntakeAppMaster } from "../../_lib/db/intakes.ts";
import { backboneFromRollup, backboneScore } from "../../_lib/app-master/backbone.ts";
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

  // …and it leaves NO card on the pipeline board. The board entry used to be
  // filed BEFORE the dispatch, so every failed attempt (an unpaired kp fails
  // them all, before a byte leaves the process) parked a phantom agent in the
  // Offer column — and each retry minted a fresh agent id, so they accumulated.
  const entryId = `m-agent-${body.hiredAgentId}-job-d2`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 90);
  assert.equal(getPipelineEntry(entryId), null, "a failed dispatch must not leave a phantom Offer-stage card");
});

test("dispatch route: a present-but-unusable budget is refused, never swapped for the suggestion", async () => {
  insertJob(job("job-d3", "Budget Role"), undefined, "published");
  process.env.PERSONAS_BRIDGE_URL = "http://127.0.0.1:9420";
  process.env.PERSONAS_BRIDGE_KEY = "pk_unit_test";
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ requestId: "pr-77" }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  saveAgentFitSpec({ jobId: "job-d3", fit: { verdict: "temporary", coverage: [], coverageRatio: 0.5 }, spec: SPEC, budget: { suggestedMonthlyUsd: 400, rule: "2% of salary-band midpoint", salaryBandRef: "x" }, metrics: [], source: "llm" });

  const dispatchWith = (overrides: unknown) =>
    dispatchPost(
      new NextRequest("http://localhost/api/agents/dispatch", {
        method: "POST",
        body: JSON.stringify({ jobId: "job-d3", overrides }),
        headers: { "content-type": "application/json" },
      })
    );

  // The client refuses these, but the client is not a bound — anything can POST
  // here. Pre-fix each one fell through to `suggestedMonthlyUsd`, so an operator
  // asking for a cap of -500 / "2000" dispatched a $400/month agent, 200 OK, with
  // nothing saying the number had been replaced.
  for (const bad of [-500, "2000", true, {}]) {
    const r = await dispatchWith({ budgetUsd: bad });
    assert.equal(r.status, 400, `expected 400 for budgetUsd ${JSON.stringify(bad)}`);
  }
  assert.equal(calls, 0, "a refused budget must not reach Personas");
  assert.equal(getActiveHiredAgentForJob("job-d3"), null, "…and must not mint a hire");

  // An omitted budget still falls back to the stored suggestion — the documented
  // buildOverrides contract (a blank field drops the key entirely).
  const ok = await dispatchWith({ name: "A" });
  assert.equal(ok.status, 200);
  const hire = getActiveHiredAgentForJob("job-d3");
  assert.equal(hire?.budgetUsd, 400, "an omitted budget keeps using the suggestion");
});

test("refresh route: the response never carries the agent's report token", async () => {
  // report_token is the ONLY auth on the PUBLIC /api/agents/report/[token]
  // endpoint. The roster read (GET /api/agents) strips it; this pull-fallback
  // returned the store row verbatim, so anyone who could read the response could
  // then POST lifecycle/execution reports for the agent with no session at all.
  const agent = createHiredAgent({ jobId: "job-rf1", jobTitle: "Refresh Role", spec: SPEC });
  assert.match(agent.reportToken, /^agrpt-/, "guard: the stored row does carry a token to leak");
  assert.equal(getHiredAgent(agent.id)?.reportToken, agent.reportToken, "guard: the by-id read still returns it");

  // No requestId → the earliest return path, so no Personas call is made.
  const res = await refreshPost(
    new NextRequest(`http://localhost/api/agents/${agent.id}/refresh`, { method: "POST" }),
    { params: Promise.resolve({ id: agent.id }) }
  );
  assert.equal(res.status, 200);
  const raw = await res.text();
  assert.ok(!raw.includes(agent.reportToken), "no report-token byte may reach the client");
  const parsed = JSON.parse(raw) as { agent: Record<string, unknown> };
  assert.equal("reportToken" in parsed.agent, false, "the wire projection must omit reportToken");
  assert.equal(parsed.agent.id, agent.id, "…while still returning the agent the panel re-renders");
});

// ---- App master (P4) --------------------------------------------------------
//
// Dispatch by INTAKE: the composed AppMasterSpec is validated, projected onto
// the flat spec the bridge has always sent, and ridden beside it as `appMaster`.
// The refusals are the point — an agent must not be hired into a role composed
// for a human, and a hire that owns an application must not file a phantom card
// on a board where no job is being filled.

const APP_MASTER_SPEC = {
  schemaVersion: 1,
  role: { title: "App master — kp", population: "agent", seniority: "senior", rubricVersion: "app-master-rubric-v1" },
  app: {
    name: "kp",
    repo: { url: "https://github.com/xkazm04/kp", rootPath: null, mainBranch: "main" },
    contextMapRef: "context-map.json",
    dossierId: "dossier-1",
  },
  objectives: [
    { kpiKey: "gate_green_rate", label: "Gates green", baseline: 0.7, target: 0.95, unit: "ratio", direction: "gte", windowDays: 30 },
  ],
  mandate: {
    scopeRung: 2,
    forbiddenClasses: ["test_deletion_or_skip", "gate_configuration"],
    approvalGates: ["npm run test:unit"],
    owner: "owner@example.com",
  },
  cadence: { triggers: [{ kind: "schedule", config: { cron: "0 2 * * *" } }] },
  budget: { monthlyUsd: 120, reservationPolicy: "estimate", onCap: "drain" },
  tenure: { probationDays: 30, reviewCadenceDays: 30, retireCriteria: ["two windows below the bar"] },
  agent: { name: "Kandi App Master", mission: "Move the value ledger", systemPromptDraft: "draft", connectors: ["github"], maxTurns: 40 },
  human: null,
  coercionNotes: [],
  promptVersion: "app-master-v1",
};

function appMasterIntake(patch: Record<string, unknown> = {}): string {
  const intake = createIntake({ title: "kp App master", scanId: "scan-1" });
  updateIntakeAppMaster(
    intake.id,
    {
      spec: { ...APP_MASTER_SPEC, ...patch } as never,
      fit: { verdict: "agent", perObjective: [], coverageRatio: 1, source: "llm" },
      composedAt: new Date().toISOString(),
    }
  );
  return intake.id;
}

function intakeDispatchReq(intakeId: string): NextRequest {
  return new NextRequest("http://localhost/api/agents/dispatch", {
    method: "POST",
    body: JSON.stringify({ intakeId }),
    headers: { "content-type": "application/json" },
  });
}

test("dispatch route: an App-master intake dispatches by intakeId, sends `appMaster` beside `spec`, and files NO board card", async () => {
  process.env.PERSONAS_BRIDGE_URL = "http://127.0.0.1:9420";
  process.env.PERSONAS_BRIDGE_KEY = "pk_unit_test";
  let sent: Record<string, unknown> = {};
  let calls = 0;
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    calls += 1;
    sent = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
    return new Response(JSON.stringify({ requestId: "pr-am-1" }), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;

  const intakeId = appMasterIntake();
  const res = await dispatchPost(intakeDispatchReq(intakeId));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { hiredAgentId: string; requestId: string; status: string };
  assert.equal(body.requestId, "pr-am-1");
  assert.equal(body.status, "pending_approval");

  // The wire contract: `appMaster` is ADDITIVE — `spec` still carries a complete
  // flat persona request, projected from appMaster.agent, so a Personas build
  // without the hire handler v2 still hires correctly.
  const spec = sent.spec as Record<string, unknown>;
  const appMasterSent = sent.appMaster as Record<string, unknown>;
  const kp = sent.kp as Record<string, unknown>;
  assert.equal(spec.name, "Kandi App Master");
  assert.equal(spec.maxBudgetUsd, 120, "the flat budget is the App-master monthly ceiling");
  assert.deepEqual(spec.connectors, ["github"]);
  assert.equal((spec.successMetrics as unknown[]).length, 1, "objectives become the success metrics");
  assert.equal((appMasterSent.mandate as { scopeRung: number }).scopeRung, 2, "the mandate rides the wire intact");
  assert.equal(kp.intakeId, intakeId, "the kp block resolves back to the intake, since there is no job");
  assert.equal(kp.jobId, "", "…and carries no job id to pretend otherwise");
  assert.ok(typeof sent.reportToken === "string" && sent.reportToken, "the report capability still rides the dispatch");

  // The hire is stored with its intake link and the dispatched spec.
  const hire = getHiredAgent(body.hiredAgentId);
  assert.equal(hire?.intakeId, intakeId);
  assert.equal(hire?.jobId, "", "an App master owns an application, not a job posting");
  assert.equal((hire?.appMaster as { promptVersion?: string } | null)?.promptVersion, "app-master-v1");

  // NO phantom Offer-stage card: there is no job being filled.
  const entryId = `m-agent-${body.hiredAgentId}-`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 90);
  assert.equal(getPipelineEntry(entryId), null);

  // Idempotent per intake — a double-click reuses the in-flight hire.
  const again = await dispatchPost(intakeDispatchReq(intakeId));
  assert.equal(again.status, 200);
  const againBody = (await again.json()) as { existing?: boolean; hiredAgentId: string };
  assert.equal(againBody.existing, true);
  assert.equal(againBody.hiredAgentId, body.hiredAgentId);
  assert.equal(calls, 1, "Personas is NOT re-POSTed on the idempotent path");
});

test("dispatch route: a human-population App master is refused 400 before a byte leaves the process", async () => {
  process.env.PERSONAS_BRIDGE_URL = "http://127.0.0.1:9420";
  process.env.PERSONAS_BRIDGE_KEY = "pk_unit_test";
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ requestId: "pr-either" }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const intakeId = appMasterIntake({ role: { ...APP_MASTER_SPEC.role, population: "human" } });
  const res = await dispatchPost(intakeDispatchReq(intakeId));
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { code?: string }).code, "AGENT_DISPATCH_HUMAN_POPULATION");
  assert.equal(calls, 0, "a refused population must not reach Personas");
  assert.equal(getActiveHiredAgentForIntake(intakeId), null, "…and must not mint a hire");

  // `either` is the requestor's choice, not a refusal.
  const eitherId = appMasterIntake({ role: { ...APP_MASTER_SPEC.role, population: "either" } });
  assert.equal((await dispatchPost(intakeDispatchReq(eitherId))).status, 200);
});

test("dispatch route: an unpaired kp 502s the App-master dispatch (hire marked failed); an uncomposed intake 409s", async () => {
  // Composed but UNPAIRED (the default): the dispatch is attempted and fails at
  // the bridge, so the roster shows a `failed` row saying why — the shipped
  // job-path semantics, unchanged.
  const intakeId = appMasterIntake();
  const res = await dispatchPost(intakeDispatchReq(intakeId));
  assert.equal(res.status, 502);
  const body = (await res.json()) as { hiredAgentId: string; code?: string };
  assert.equal(body.code, "AGENT_DISPATCH_BRIDGE_FAILED");
  assert.equal(getHiredAgent(body.hiredAgentId)?.status, "failed");
  assert.equal(getActiveHiredAgentForIntake(intakeId), null, "a failed dispatch doesn't block a retry");

  // Not composed at all → 409, nothing minted.
  const bare = createIntake({ title: "unfinished", scanId: "scan-2" });
  const none = await dispatchPost(intakeDispatchReq(bare.id));
  assert.equal(none.status, 409);
  assert.equal(((await none.json()) as { code?: string }).code, "AGENT_DISPATCH_NOT_COMPOSED");
});

test("report route: probation_review moves the agent by its DECISION, and a decisionless one is a 400", async () => {
  const agent = createHiredAgent({ jobTitle: "App master", intakeId: "intake-x", appMaster: APP_MASTER_SPEC, spec: SPEC }, "ws-pr");
  updateHiredAgentStatus(agent.id, "onboarding", {}, "ws-pr");

  // A review with no decision is not a review.
  const bad = await report(agent.reportToken, { kind: "lifecycle", event: "probation_review" });
  assert.equal(bad.status, 400);
  assert.equal(getHiredAgent(agent.id, "ws-pr")?.status, "onboarding", "the refused report changed nothing");

  // extended: MORE PROBATION IS NOT A PROMOTION — the agent stays in onboarding.
  const extended = await report(agent.reportToken, { kind: "lifecycle", event: "probation_review", decision: "extended", note: "two more weeks" });
  assert.equal(extended.status, 200);
  assert.equal(getHiredAgent(agent.id, "ws-pr")?.status, "onboarding");

  const activated = await report(agent.reportToken, { kind: "lifecycle", event: "probation_review", decision: "activated", note: "backbone passed" });
  assert.equal(activated.status, 200);
  assert.equal(getHiredAgent(agent.id, "ws-pr")?.status, "active");

  const retired = await report(agent.reportToken, { kind: "lifecycle", event: "probation_review", decision: "retired", note: "no movement" });
  assert.equal(retired.status, 200);
  assert.equal(getHiredAgent(agent.id, "ws-pr")?.status, "retired");
  // A retired agent's token is dead — the next report 404s like an unknown one.
  assert.equal((await report(agent.reportToken, { kind: "lifecycle", event: "activated" })).status, 404);
});

test("report route: a v2 rollup's backbone reading lands in the ledger and scores the roster verdict", async () => {
  const agent = createHiredAgent({ jobTitle: "App master", intakeId: "intake-y", appMaster: APP_MASTER_SPEC, spec: SPEC }, "ws-bb");
  const res = await report(agent.reportToken, {
    kind: "rollup",
    period: "2026-08",
    runs: 12,
    successes: 12,
    failures: 0,
    costUsd: 90,
    // Internally inconsistent on purpose: 9 merges out of 5 opens would render a
    // 180% delivery rate on the roster.
    proposalsOpened: 5,
    proposalsMerged: 9,
    proposalsReverted: 40,
    gatePassRate: 1.4,
    forbiddenClassViolations: 0,
    kpiDeltas: [{ kpiKey: "gate_green_rate", baseline: 0.7, current: 0.96, target: 0.95, direction: "gte", windowDays: 30, measured: true }],
    budgetReservedUsd: 120,
    budgetSettledUsd: 90,
    budgetUnmeasured: false,
    ledgerConsistent: true,
    autopilotMode: "suggest",
  });
  assert.equal(res.status, 200);

  const stored = getLatestAgentRollupRaw(agent.id, "ws-bb");
  assert.equal(stored?.period, "2026-08");
  const raw = stored?.raw as Record<string, unknown>;
  assert.equal(raw.proposalsMerged, 5, "merged is capped at opened");
  assert.equal(raw.proposalsReverted, 5, "reverted is capped at merged");
  assert.equal(raw.gatePassRate, 1, "the gate rate is clamped into 0..1");
  assert.equal(raw.autopilotMode, "suggest");
  assert.equal(raw.runs, 12, "the v1 fields still land beside it");

  const score = backboneScore(backboneFromRollup(raw));
  assert.equal(score.verdict, "pass");
  assert.equal(score.rules.find((r) => r.rule === "delivery")?.value, 1, "5 of 5 merged, not 180%");
});
