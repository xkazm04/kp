// S3 producer: attaches the job's newest approved dev case id; no case -> the floor's null.
import "better-sqlite3";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { ensureDb } from "../db/core.ts";
import { DEFAULT_STAGE_RUNNERS, type StageContext } from "../role-run-engine.ts";
import { appendStageArtifact, getOrCreateRoleRun } from "../db/role-runs.ts";
import { saveDevCase } from "../db/devcase.ts";
import { DEFAULT_WORKSPACE_ID } from "../db/workspaces.ts";
import { insertJob } from "../job-ingest.ts";
import type { JobRecord } from "../db/core.ts";
import type { CaseAssignmentPayload } from "../role-run-stages.ts";
import { caseProducer } from "./case.ts";

before(() => {
  ensureDb();
  for (const id of ["jd-cs-a", "jd-cs-b"]) {
    insertJob({ id, title: "Engineer", requirements: [{ skill: "java", kind: "skill", hardness: "must" }] } as unknown as JobRecord, undefined, "published");
  }
});
after(() => cleanupUnitDb());

const ctxFor = (jobId: string, branch: string): StageContext => ({
  run: getOrCreateRoleRun({ jobId }).run,
  kind: "case_assignment",
  branchRef: branch,
  previous: null,
  workspaceId: DEFAULT_WORKSPACE_ID,
  now: Date.now(),
});
const mkCase = (jobId: string) =>
  saveDevCase({ need: { jobId }, analysis: null, role: { title: "Engineer" }, case: { title: "Case" } }).id;

test("a job with an approved dev case gets that id on the assignment, floor fields untouched", async () => {
  const first = mkCase("jd-cs-a");
  await new Promise((r) => setTimeout(r, 5));
  const newest = mkCase("jd-cs-a");
  const ctx = ctxFor("jd-cs-a", "pe-1");
  const out = await caseProducer().run(ctx);
  const floor = (await DEFAULT_STAGE_RUNNERS.case_assignment(ctx)).payload as CaseAssignmentPayload;
  const p = out.payload as CaseAssignmentPayload;
  assert.equal(out.status, "complete");
  assert.equal(p.assignments[0].devcaseId, newest);
  assert.notEqual(newest, first);
  assert.ok(p.assignments[0].devcaseId?.startsWith("dc"));
  assert.deepEqual({ ...p.assignments[0], devcaseId: null }, floor.assignments[0]);
  assert.equal(p.caseDesignHash, floor.caseDesignHash);
});

test("every branch of the run gets the same case id", async () => {
  const id = mkCase("jd-cs-b");
  const producer = caseProducer({ findCaseId: () => id });
  for (const b of ["pe-1", "pe-2", "pe-3"]) {
    const p = (await producer.run(ctxFor("jd-cs-b", b))).payload as CaseAssignmentPayload;
    assert.equal(p.assignments[0].devcaseId, id);
  }
});

test("a job without a dev case records the floor's honest null", async () => {
  const ctx = ctxFor("jd-cs-nocase", "pe-1");
  const p = (await caseProducer().run(ctx)).payload as CaseAssignmentPayload;
  assert.equal(p.assignments[0].devcaseId, null);
  assert.deepEqual(p, (await DEFAULT_STAGE_RUNNERS.case_assignment(ctx)).payload);
});

test("the payload passes the write door's PII check", async () => {
  const ctx = ctxFor("jd-cs-a", "pe-9");
  const out = await caseProducer({ findCaseId: () => "dc_abc123" }).run(ctx);
  assert.doesNotThrow(() => appendStageArtifact({ runId: ctx.run.id, kind: "case_assignment", branchRef: "pe-9", status: out.status, payload: out.payload }));
});
