// The engine claim on POST /api/pipeline/[id] (2026-11-08 offer and scorecard doors scan).
// `actor: "sim"` exists so the guided simulation's accepts are logged as the engine. On a
// REAL candidate it let anyone holding pipeline:write file their own advance, or their own
// extended offer, into the sealed chain as "auto:sim", with no name on it. The claim now
// survives only on a (SIM)-titled entry.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { POST as actionPost } from "./[id]/route.ts";
import { createPipelineEntry, setApproval } from "../../_lib/db/pipeline.ts";
import { listDecisionRecords } from "../../_lib/decision-record-store.ts";
import { DEFAULT_WORKSPACE_ID } from "../../_lib/db/workspaces.ts";

after(() => cleanupUnitDb());

let seq = 0;
function entry(jobTitle: string, stage: string): string {
  seq += 1;
  const { entry: created } = createPipelineEntry({
    candidateId: `engine-claim-c${seq}`,
    candidateLabel: `Engine Claim Candidate ${seq}`,
    jobId: `engine-claim-job-${seq}`,
    jobTitle,
    stage,
  });
  return created.id;
}

async function acceptAsEngine(id: string): Promise<Response> {
  const request = new NextRequest(`http://localhost/api/pipeline/${id}`, {
    method: "POST",
    body: JSON.stringify({ action: "accept", actor: "sim" }),
    headers: { "content-type": "application/json" },
  });
  return (await actionPost(request, { params: Promise.resolve({ id }) })) as unknown as Response;
}

const sealOf = (id: string, kinds: readonly string[]) =>
  listDecisionRecords({ candidateRef: id, limit: 10, workspaceId: DEFAULT_WORKSPACE_ID }).find((r) => kinds.includes(r.kind));

test("a real candidate's accept stays a person's act whatever the body claims", async () => {
  const id = entry("Backend Engineer", "Screened");
  const res = await acceptAsEngine(id);
  assert.equal(res.status, 200);
  const seal = sealOf(id, ["advanced", "auto_advanced"]);
  assert.equal(seal?.kind, "advanced");
  assert.match(seal?.actor ?? "", /^human:/);
});

test("a real candidate's extended offer is never sealed as the engine's", async () => {
  const id = entry("Backend Engineer", "Offer");
  setApproval(id, "offer_review", JSON.stringify({ subject: "Offer", body: "Hello", recommended: 90_000, currency: "EUR" }));
  await acceptAsEngine(id);
  const seal = sealOf(id, ["offer_terms"]);
  assert.ok(seal, "the extend seals its terms");
  assert.match(seal.actor, /^human:/);
});

test("the guided simulation keeps its truthful engine attribution", async () => {
  const id = entry("Backend Engineer (SIM)", "Screened");
  const res = await acceptAsEngine(id);
  assert.equal(res.status, 200);
  const seal = sealOf(id, ["advanced", "auto_advanced"]);
  assert.equal(seal?.kind, "auto_advanced");
  assert.equal(seal?.actor, "auto:sim");
});
