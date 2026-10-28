// GET /api/role-runs/[id] and GET /api/role-runs?jobId= against the real ledger in open mode:
// scoping, the 404 for a missing or foreign run, and the shape of the parked gates - codes and
// refs only, never a payload, a name or prose.
import "better-sqlite3";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { ensureDb } from "../../../_lib/db/core.ts";
import { insertJob } from "../../../_lib/job-ingest.ts";
import { createPipelineEntry } from "../../../_lib/db/pipeline.ts";
import { advanceRoleRun } from "../../../_lib/role-run-engine.ts";
import { getOrCreateRoleRun } from "../../../_lib/db/role-runs.ts";
import { createWorkspace } from "../../../_lib/db/workspaces.ts";
import type { JobRecord } from "../../../_lib/db/core.ts";
import { GET as getRun } from "./route.ts";
import { GET as listRuns } from "../route.ts";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (url: string) => new NextRequest(`http://localhost${url}`);

let n = 0;
function seedJob(): string {
  n += 1;
  const jobId = `jd-get-route-${n}`;
  insertJob({ id: jobId, title: "Get Route Role", requirements: [{ skill: "java", kind: "skill", hardness: "must" }] } as unknown as JobRecord, undefined, "published");
  return jobId;
}

before(() => ensureDb());
after(() => cleanupUnitDb());

test("an unknown run id is a 404 with the registered code", async () => {
  const res = await getRun(get("/api/role-runs/nope"), ctx("nope"));
  assert.equal(res.status, 404);
  assert.equal((await res.json()).code, "ROLE_RUN_NOT_FOUND");
});

test("another team's run is a 404 and leaks nothing", async () => {
  const other = createWorkspace("Other team");
  const { run } = getOrCreateRoleRun({ jobId: seedJob() }, other.id);
  const res = await getRun(get(`/api/role-runs/${run.id}`), ctx(run.id));
  assert.equal(res.status, 404);
  assert.doesNotMatch(JSON.stringify(await res.json()), new RegExp(run.id));
});

test("a fresh run reads as running with no stages and no parked gates", async () => {
  const jobId = seedJob();
  const { run } = getOrCreateRoleRun({ jobId });
  const body = await (await getRun(get(`/api/role-runs/${run.id}`), ctx(run.id))).json();
  assert.equal(body.run.status, "running");
  assert.equal(body.run.jobId, jobId);
  assert.deepEqual(body.stages, []);
  assert.deepEqual(body.gates, []);
});

test("a parked run reports its stages and the per-gate batch as refs only", async () => {
  const jobId = seedJob();
  const a = createPipelineEntry({ candidateId: `ga-${n}`, candidateLabel: "Ada Lovelace", jobId, jobTitle: "Get Route Role", matchScore: 90 }).entry;
  const b = createPipelineEntry({ candidateId: `gb-${n}`, candidateLabel: "Grace Hopper", jobId, jobTitle: "Get Route Role", matchScore: 88 }).entry;
  const { run } = getOrCreateRoleRun({ jobId });
  await advanceRoleRun(run.id);

  const res = await getRun(get(`/api/role-runs/${run.id}`), ctx(run.id));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.stages.map((s: { kind: string }) => s.kind).slice(0, 2), ["role_spec", "slate"]);
  assert.equal(body.gates.length, 1, "both candidates park at the one rejection gate: ONE batch");
  const batch = body.gates[0];
  assert.equal(batch.gate, "rejection");
  assert.equal(batch.stage, "screen");
  assert.equal(typeof batch.policyVersion, "string");
  assert.deepEqual([...batch.branchRefs].sort(), [a.id, b.id].sort());
  for (const stage of body.stages) assert.deepEqual(Object.keys(stage).sort(), ["branchRef", "kind", "producedAt", "seq", "status"]);
  assert.doesNotMatch(JSON.stringify(body), /Ada|Lovelace|Grace|Hopper|payload/, "no name, no payload on the wire");
});

test("the list answers one role's runs and refuses a missing jobId", async () => {
  const jobId = seedJob();
  const { run } = getOrCreateRoleRun({ jobId });
  const body = await (await listRuns(get(`/api/role-runs?jobId=${jobId}`))).json();
  assert.deepEqual(body.runs.map((r: { id: string }) => r.id), [run.id]);
  assert.equal((await listRuns(get("/api/role-runs"))).status, 400);
  assert.deepEqual((await (await listRuns(get("/api/role-runs?jobId=jd-nobody"))).json()).runs, []);
});
