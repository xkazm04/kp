// Drives POST /api/role-runs/[id]/gate/{preview,commit} against the real ledger in open
// mode: the happy path, all five approval refusals with their machine-readable reason,
// the not-parked / invalid / unknown-run answers, and that the approver is server-bound.
import "better-sqlite3";
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../../../_lib/testing/unit-db.ts";
import { ensureDb } from "../../../../_lib/db/core.ts";
import { insertJob } from "../../../../_lib/job-ingest.ts";
import { createPipelineEntry } from "../../../../_lib/db/pipeline.ts";
import { advanceRoleRun } from "../../../../_lib/role-run-engine.ts";
import { getOrCreateRoleRun, latestStageArtifact, listStageArtifacts } from "../../../../_lib/db/role-runs.ts";
import { roleRunGateToken, verifyRoleRunGateToken } from "../../../../_lib/role-run-gates.ts";
import { resolveRoleRunGateSubject } from "../../../../_lib/role-run-gate-preview.ts";
import { consumeScreenWaveApprovalToken, resetScreenWaveApprovalSpendForTests } from "../../../../_lib/screen-wave-approval.ts";
import type { JobRecord } from "../../../../_lib/db/core.ts";
import { POST as preview } from "./preview/route.ts";
import { POST as commit } from "./commit/route.ts";

const JOB_ID = "jd-gate-routes";

function req(url: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const previewReq = (id: string, body: unknown) => preview(req(`/api/role-runs/${id}/gate/preview`, body), ctx(id));
const commitReq = (id: string, body: unknown) => commit(req(`/api/role-runs/${id}/gate/commit`, body), ctx(id));

/** A fresh run with ONE candidate parked at the rejection gate. */
let n = 0;
async function parkedRun() {
  n += 1;
  const jobId = `${JOB_ID}-${n}`;
  insertJob(
    { id: jobId, title: "Gate Route Role", requirements: [{ skill: "java", kind: "skill", hardness: "must" }] } as unknown as JobRecord,
    undefined,
    "published"
  );
  const { entry } = createPipelineEntry({ candidateId: `cand-${n}`, candidateLabel: `Candidate ${n}`, jobId, jobTitle: "Gate Route Role", matchScore: 90 });
  const { run } = getOrCreateRoleRun({ jobId });
  await advanceRoleRun(run.id);
  return { runId: run.id, branchRef: entry.id };
}

before(() => {
  ensureDb();
  process.env.KP_OPERATOR_NAME = "Test Reviewer";
});
beforeEach(() => resetScreenWaveApprovalSpendForTests());
after(() => {
  delete process.env.KP_OPERATOR_NAME;
  cleanupUnitDb();
});

test("preview returns the server-derived set and a token the protocol accepts", async () => {
  const { runId, branchRef } = await parkedRun();
  const res = await previewReq(runId, { gate: "rejection", branchRef });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.subjectRefs, [branchRef]);
  assert.equal(verifyRoleRunGateToken(body.token, runId, "rejection", body.policyVersion, body.subjectRefs).ok, true);
  assert.ok(body.expiresAt > body.issuedAt);
});

test("commit resolves the branch; a client-supplied approver is ignored", async () => {
  const { runId, branchRef } = await parkedRun();
  const { token } = await (await previewReq(runId, { gate: "rejection", branchRef })).json();
  const res = await commitReq(runId, { gate: "rejection", branchRef, decision: "approved", approvalToken: token, approvedBy: "Mallory" });
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.status, "complete");
  assert.equal(out.continued, "advanced", "a successful commit takes one pass");
  assert.ok(Array.isArray(out.awaiting));
  const resolved = latestStageArtifact(runId, "screen", branchRef);
  const ref = (resolved?.payload as { approverRef?: string }).approverRef;
  assert.ok(ref && ref.length > 0);
  assert.doesNotMatch(JSON.stringify(resolved?.payload), /Mallory|Test Reviewer/, "the ledger holds a hash, never a name");
});

test("all five approval refusals answer 409 with their own reason and code", async () => {
  const { runId, branchRef } = await parkedRun();
  const send = (token: string | undefined) => commitReq(runId, { gate: "rejection", branchRef, decision: "approved", approvalToken: token });
  const expect = async (res: Response, reason: string) => {
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.reason, reason);
    assert.equal(body.code, `SCREEN_WAVE_APPROVAL_${reason.toUpperCase()}`);
  };
  const subject = resolveRoleRunGateSubject(runId, "rejection", branchRef);
  const sign = (issuedAt: number, refs = subject.subjectRefs) => roleRunGateToken(runId, "rejection", subject.policyVersion, refs, issuedAt);

  await expect(await send(undefined), "required");
  await expect(await send(sign(Date.now() - 16 * 60_000)), "expired");
  await expect(await send(sign(Date.now(), ["some-other-entry"])), "mismatch");

  const spentToken = sign(Date.now());
  assert.equal(consumeScreenWaveApprovalToken(spentToken), true);
  await expect(await send(spentToken), "spent");

  // Unattributed: no named approver on the deployment.
  delete process.env.KP_OPERATOR_NAME;
  try {
    await expect(await send(sign(Date.now())), "unattributed");
  } finally {
    process.env.KP_OPERATOR_NAME = "Test Reviewer";
  }
  // Every refusal above left the branch parked: nothing was resolved, the live token survives.
  assert.equal(latestStageArtifact(runId, "screen", branchRef)?.status, "awaiting_approval");
});

test("a branch that is not parked at the gate is 409 ROLE_RUN_GATE_NOT_PARKED, before any token is spent", async () => {
  const { runId, branchRef } = await parkedRun();
  const { token } = await (await previewReq(runId, { gate: "rejection", branchRef })).json();
  assert.equal((await commitReq(runId, { gate: "rejection", branchRef, decision: "declined", approvalToken: token })).status, 200);
  const again = await commitReq(runId, { gate: "rejection", branchRef, decision: "declined", approvalToken: token });
  assert.equal(again.status, 409);
  assert.equal((await again.json()).code, "ROLE_RUN_GATE_NOT_PARKED");
  const wrongGate = await previewReq(runId, { gate: "offer", branchRef });
  assert.equal(wrongGate.status, 409);
});

test("malformed bodies are 400 and an unknown run is 404, both coded", async () => {
  const { runId, branchRef } = await parkedRun();
  for (const body of [{}, { gate: "nope", branchRef }, { gate: "rejection" }]) {
    const res = await previewReq(runId, body);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, "ROLE_RUN_GATE_INVALID");
  }
  const noDecision = await commitReq(runId, { gate: "rejection", branchRef, decision: "maybe" });
  assert.equal(noDecision.status, 400);
  const missing = await previewReq("rr-does-not-exist", { gate: "rejection", branchRef });
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).code, "ROLE_RUN_NOT_FOUND");
});

test("a refused commit takes no pass and reports none", async () => {
  const { runId, branchRef } = await parkedRun();
  const before = listStageArtifacts(runId).length;
  const res = await commitReq(runId, { gate: "rejection", branchRef, decision: "approved" });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).continued, undefined);
  assert.equal(listStageArtifacts(runId).length, before);
});
