// The job-page panel's walk, driven against the REAL route handlers (open mode, real ledger,
// keyless floor): a run on job-001 is started from the panel's client, and every gate it parks
// at is crossed as one batch, with no advance click between them.
import "better-sqlite3";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../../../_lib/testing/unit-db.ts";
import { ensureDb } from "../../../../_lib/db/core.ts";
import { insertJob } from "../../../../_lib/job-ingest.ts";
import { createPipelineEntry } from "../../../../_lib/db/pipeline.ts";
import type { JobRecord } from "../../../../_lib/db/core.ts";
import { POST as startRoute, GET as listRoute } from "../../../../api/role-runs/route.ts";
import { GET as getRoute } from "../../../../api/role-runs/[id]/route.ts";
import { POST as advanceRoute } from "../../../../api/role-runs/[id]/advance/route.ts";
import { POST as previewRoute } from "../../../../api/role-runs/[id]/gate/preview/route.ts";
import { POST as commitRoute } from "../../../../api/role-runs/[id]/gate/commit/route.ts";
import { commitGateBatch, loadRoleRunForJob, previewGateBatch, startRoleRun } from "./roleRunPanelClient.ts";

type Handler = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

const HANDLERS: Record<string, Handler> = {
  "GET /api/role-runs": listRoute as unknown as Handler,
  "POST /api/role-runs": startRoute as unknown as Handler,
  "GET /api/role-runs/:id": getRoute as unknown as Handler,
  "POST /api/role-runs/:id/advance": advanceRoute as unknown as Handler,
  "POST /api/role-runs/:id/gate/preview": previewRoute as unknown as Handler,
  "POST /api/role-runs/:id/gate/commit": commitRoute as unknown as Handler,
};

/** `fetch` served by the route handlers themselves. */
async function routedFetch(input: string, init?: RequestInit): Promise<Response> {
  const req = new NextRequest(`http://localhost${input}`, init as ConstructorParameters<typeof NextRequest>[1]);
  const pathname = new URL(req.url).pathname;
  const id = /^\/api\/role-runs\/([^/]+)/.exec(pathname)?.[1] ?? "";
  const handler = HANDLERS[`${req.method} ${pathname.replace(/^\/api\/role-runs\/[^/]+/, "/api/role-runs/:id")}`];
  assert.ok(handler, `no route for ${req.method} ${input}`);
  return handler(req, { params: Promise.resolve({ id }) });
}

const JOB_ID = "job-001";
const seedJob = (jobId: string, title: string) =>
  insertJob({ id: jobId, title, requirements: [{ skill: "java", kind: "skill", hardness: "must" }] } as unknown as JobRecord, undefined, "published");

before(() => {
  ensureDb();
  process.env.KP_OPERATOR_NAME = "Test Reviewer";
  seedJob(JOB_ID, "Panel Role");
  for (const i of [1, 2]) createPipelineEntry({ candidateId: `panel-${i}`, candidateLabel: `Panel ${i}`, jobId: JOB_ID, jobTitle: "Panel Role", matchScore: 92 });
});
after(() => {
  delete process.env.KP_OPERATOR_NAME;
  cleanupUnitDb();
});

test("a role with no run loads as null; the panel then starts one", async () => {
  const none = await loadRoleRunForJob(routedFetch, JOB_ID);
  assert.deepEqual(none, { ok: true, value: null });
  const started = await startRoleRun(routedFetch, JOB_ID);
  assert.ok(started.ok);
  assert.equal(started.value.run.jobId, JOB_ID);
  assert.equal(started.value.gates[0]?.gate, "rejection", "the first pass parks at the first gate");
  const again = await loadRoleRunForJob(routedFetch, JOB_ID);
  assert.ok(again.ok && again.value?.run.id === started.value.run.id, "a reload finds the same run");
});

test("every gate the run parks at is crossed as one batch, with no advance click", async () => {
  const loaded = await loadRoleRunForJob(routedFetch, JOB_ID);
  assert.ok(loaded.ok && loaded.value);
  const runId = loaded.value.run.id;
  const crossed: string[] = [];
  for (let guard = 0; guard < 6; guard++) {
    const view = await (await routedFetch(`/api/role-runs/${runId}`)).json();
    const batch = view.gates[0];
    if (!batch) break;
    const preview = await previewGateBatch(routedFetch, runId, batch);
    assert.ok(preview.ok && preview.value.length === batch.branchRefs.length, "a read-only preview per parked branch");
    const out = await commitGateBatch(routedFetch, runId, batch, "approved");
    assert.equal(out.refusal, null, `gate ${batch.gate}`);
    assert.deepEqual([...out.committed].sort(), [...batch.branchRefs].sort(), "the whole batch is resolved");
    crossed.push(batch.gate);
  }
  assert.deepEqual(crossed, ["rejection", "interview_invite", "offer"]);
  const final = await (await routedFetch(`/api/role-runs/${runId}`)).json();
  assert.deepEqual(final.gates, []);
});

test("without a named approver the batch stops on the registered code and commits nothing", async () => {
  const jobId = "job-001-b";
  seedJob(jobId, "Panel Role B");
  createPipelineEntry({ candidateId: "panel-b", candidateLabel: "Panel B", jobId, jobTitle: "Panel Role B", matchScore: 92 });
  const started = await startRoleRun(routedFetch, jobId);
  assert.ok(started.ok);
  delete process.env.KP_OPERATOR_NAME;
  try {
    const out = await commitGateBatch(routedFetch, started.value.run.id, started.value.gates[0], "approved");
    assert.deepEqual(out.committed, []);
    assert.equal(out.refusal?.code, "SCREEN_WAVE_APPROVAL_UNATTRIBUTED");
    assert.equal(out.refusal?.reason, "unattributed");
  } finally {
    process.env.KP_OPERATOR_NAME = "Test Reviewer";
  }
  const still = await loadRoleRunForJob(routedFetch, jobId);
  assert.ok(still.ok && still.value?.gates[0]?.gate === "rejection", "H5 stays a human step: the gate is still parked");
});
