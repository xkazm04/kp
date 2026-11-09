// A gate commit continues the run with ONE pass; a refused commit takes none.
import "better-sqlite3";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { ensureDb } from "./db/core.ts";
import { insertJob } from "./job-ingest.ts";
import { createPipelineEntry } from "./db/pipeline.ts";
import { advanceRoleRun, RoleRunGateNotParkedError } from "./role-run-engine.ts";
import { getOrCreateRoleRun, listStageArtifacts } from "./db/role-runs.ts";
import { roleRunGateToken } from "./role-run-gates.ts";
import { resolveRoleRunGateSubject } from "./role-run-gate-preview.ts";
import { commitRoleRunStageGateAndContinue } from "./role-run-commit-continue.ts";
import type { JobRecord } from "./db/core.ts";
import { DEFAULT_STAGE_RUNNERS } from "./role-run-engine.ts";

const STAND_IN_APPROVER = "test-approver";
let n = 0;
async function parkedRun() {
  n += 1;
  const jobId = `jd-commit-continue-${n}`;
  insertJob({ id: jobId, title: "Continue Role", requirements: [{ skill: "java", kind: "skill", hardness: "must" }] } as unknown as JobRecord, undefined, "published");
  const { entry } = createPipelineEntry({ candidateId: `cc-${n}`, candidateLabel: `Cand ${n}`, jobId, jobTitle: "Continue Role", matchScore: 90 });
  const { run } = getOrCreateRoleRun({ jobId });
  await advanceRoleRun(run.id);
  return { runId: run.id, branchRef: entry.id };
}
function input(runId: string, branchRef: string, over: Record<string, unknown> = {}) {
  const subject = resolveRoleRunGateSubject(runId, "rejection", branchRef);
  const now = Date.now();
  return {
    runId,
    branchRef,
    gate: "rejection" as const,
    decision: "approved" as const,
    policyVersion: subject.policyVersion,
    subjectRefs: subject.subjectRefs,
    token: roleRunGateToken(runId, "rejection", subject.policyVersion, subject.subjectRefs, now),
    approver: STAND_IN_APPROVER,
    now,
    ...over,
  };
}

before(() => ensureDb());
after(() => cleanupUnitDb());

test("a successful commit takes one pass and reports the outcome", async () => {
  const { runId, branchRef } = await parkedRun();
  const out = await commitRoleRunStageGateAndContinue(input(runId, branchRef), undefined, { advance: { runners: DEFAULT_STAGE_RUNNERS } });
  assert.equal(out.status, "complete");
  assert.equal(out.pass.outcome, "advanced");
  if (out.pass.outcome === "advanced") assert.ok(Array.isArray(out.pass.awaiting));
});

test("a refused commit throws and takes no pass", async () => {
  const { runId, branchRef } = await parkedRun();
  const before = listStageArtifacts(runId).length;
  await assert.rejects(() => commitRoleRunStageGateAndContinue(input(runId, branchRef, { token: "bad" })));
  assert.equal(listStageArtifacts(runId).length, before);
  // not parked: the same gate on an unknown branch
  await assert.rejects(() => commitRoleRunStageGateAndContinue(input(runId, branchRef, { branchRef: "nope" })), (e) => e instanceof RoleRunGateNotParkedError);
});

test("a failing pass leaves the commit standing and is reported, not thrown", async () => {
  const { runId, branchRef } = await parkedRun();
  const out = await commitRoleRunStageGateAndContinue(input(runId, branchRef), undefined, {
    advance: { readUsage: () => { throw new Error("runner exploded"); } },
  });
  assert.equal(out.status, "complete");
  assert.equal(out.pass.outcome, "failed");
  if (out.pass.outcome === "failed") assert.match(out.pass.error, /runner exploded/);
});

test("continueRun:false commits without a pass", async () => {
  const { runId, branchRef } = await parkedRun();
  const out = await commitRoleRunStageGateAndContinue(input(runId, branchRef), undefined, { continueRun: false });
  assert.equal(out.pass.outcome, "skipped");
});
