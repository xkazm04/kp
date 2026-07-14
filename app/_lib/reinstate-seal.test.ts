// Audit symmetry (Direction 2) — a human reversal of an auto-rejection is sealed
// into the same tamper-evident chain as the rejection it overturns, attributed to
// the HUMAN who overturned it (never the machine), and lands on the candidate's own
// team chain. The seal itself is placed at the reinstate ROUTE (app/api/pipeline/[id]),
// where the actor context lives; this test verifies the behavior at the LIB level
// (the route handler pulls in the NextRequest runtime artifact, which doesn't resolve
// in a worktree test process), by exercising the exact reinstate flow + seal the route
// runs and asserting the resulting chain.
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createPipelineEntry, actOnPipelineEntry, reinstatePipelineEntry } from "./db/pipeline.ts";
import { sealDecisionSafe, listDecisionRecords, verifyDecisionChain } from "./decision-record-store.ts";
import { decisionAttribution } from "./decision-attribution.ts";

after(() => cleanupUnitDb());

test("'reinstated' attributes to the human, never the machine", () => {
  // The whole point: the reversal must not credit automation like its inverse
  // (auto_rejected). A recruiter overturned it — attribution is human.
  assert.equal(decisionAttribution("reinstated"), "human");
  assert.equal(decisionAttribution("auto_rejected"), "auto");
});

test("a reinstate seals a 'reinstated' record onto the candidate's team chain, actor human, alongside the auto_rejected it reverses", () => {
  const ws = "team-a";
  const { entry } = createPipelineEntry({
    candidateId: "rs-c1",
    candidateLabel: "Reversed Candidate",
    jobId: "rs-job",
    jobTitle: "Reinstate Test Role",
    stage: "Screened",
    matchScore: 10,
    archetype: "bau",
    contact: "rs-c1@example.com",
    workspaceId: ws,
  });

  // 1. The wave auto-rejects + seals (mirrors screen-wave).
  const rejected = actOnPipelineEntry(entry.id, "reject", "Auto-rejected · policy.", { expectedStage: "Screened", actor: "system" }, ws);
  assert.ok(rejected && rejected.status === "rejected");
  sealDecisionSafe({
    kind: "auto_rejected",
    actor: "auto:screen-wave",
    policyVersion: "screen-wave/bottom100/maxMatch100",
    candidateRef: entry.id,
    rationale: "Auto-rejected · policy.",
    reasonCode: "reject",
    inputs: { score: 10 },
  });

  // 2. A recruiter reinstates (raw DB reversal — records the pipeline event)…
  const restored = reinstatePipelineEntry(entry.id, ws);
  assert.ok(restored && restored.status === "active" && restored.stage === "Screened");

  // …and the ROUTE seals the reversal (this is the exact seal the route places).
  sealDecisionSafe({
    kind: "reinstated",
    actor: "human:recruiter",
    policyVersion: "manual",
    candidateRef: entry.id,
    rationale: "Auto-rejection reversed for re-review.",
    reasonCode: "reinstate",
    inputs: { previousStatus: "rejected", restoredStage: "Screened" },
  });

  // The team's chain now shows BOTH sides of the story — the machine's reject and
  // the human's reversal — and verifies as one tamper-evident chain.
  const records = listDecisionRecords({ candidateRef: entry.id, workspaceId: ws });
  const kinds = records.map((r) => r.kind).sort();
  assert.deepEqual(kinds, ["auto_rejected", "reinstated"]);
  const reversal = records.find((r) => r.kind === "reinstated")!;
  assert.equal(reversal.actor, "human:recruiter", "the reversal is attributed to the human");
  assert.equal(reversal.reasonCode, "reinstate");
  const payload = JSON.parse(reversal.payloadJson) as { inputs?: { previousStatus?: string } };
  assert.equal(payload.inputs?.previousStatus, "rejected", "the prior state is recorded");
  assert.ok(verifyDecisionChain(ws).ok, "the team chain verifies with the reversal on it");

  // Tenant isolation: none of this is visible on the default team's chain.
  assert.equal(listDecisionRecords({ candidateRef: entry.id }).length, 0);
});
