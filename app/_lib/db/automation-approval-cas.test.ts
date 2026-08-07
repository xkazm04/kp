// Regression coverage for actOnPipelineEntry's approval-kind CAS half
// (bug-ui-scan §hiring-automation #1). The policy pass snapshots an entry, spends
// SECONDS in Python, then applies a system advance guarded by expectedStage. But a
// human who queues a review DURING that hop changes approval_kind WITHOUT changing
// stage — invisible to the stage-only guard — so the stale system advance used to
// clear the fresh gate to NULL (or auto-consume a screening_review into the
// calendar). expectedApprovalKind closes that: a system decision fails closed when
// the approval state moved under it. Isolated throwaway DB — unit-db.ts must be the
// first project import (it sets KP_DB_PATH before any store opens a connection).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import {
  actOnPipelineEntry,
  createPipelineEntry,
  getPipelineEntry,
  listPipelineEventsForEntry,
  setApproval,
} from "./pipeline.ts";

after(() => cleanupUnitDb());

let seq = 0;
function addEntry() {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `cas-c${seq}`,
    candidateLabel: `CAS Tester ${seq}`,
    jobId: `cas-job-${seq}`,
    jobTitle: "CAS Test Role",
  });
  return entry; // Screened, approvalKind null
}

test("a human review queued mid-hop is NOT clobbered by the stale system advance (any kind)", () => {
  const entry = addEntry();
  assert.equal(entry.approvalKind, null);

  // The pass snapshotted (stage 'Screened', approvalKind null). MID-HOP a recruiter
  // queues a scorecard gate on the SAME stage.
  setApproval(entry.id, "scorecard_review", JSON.stringify({ recommendation: "review" }));

  // The system advance lands against the STALE snapshot. Stage still matches, but
  // the approval appeared — fail closed.
  const result = actOnPipelineEntry(
    entry.id,
    "accept",
    "policy: advance",
    { expectedStage: "Screened", expectedApprovalKind: null, actor: "system" }
  );

  assert.equal(result, null, "the stale system advance must be skipped");
  const fresh = getPipelineEntry(entry.id)!;
  assert.equal(fresh.stage, "Screened", "the entry must not move a stage");
  assert.equal(fresh.approvalKind, "scorecard_review", "the human's fresh gate must survive intact");
  // No advance event of either attribution was written.
  const advances = listPipelineEventsForEntry(entry.id).filter((e) => e.kind === "advanced" || e.kind === "auto_advanced");
  assert.equal(advances.length, 0, "no advance event should be recorded for the skipped decision");
});

test("a screening_review queued mid-hop is NOT auto-consumed by the stale system advance", () => {
  const entry = addEntry();

  // The dangerous case: a screening_review would otherwise take the branch that
  // advances AND opens the calendar gate — silently resolving the human's review.
  setApproval(entry.id, "screening_review", JSON.stringify({ recommendation: "advance" }));

  const result = actOnPipelineEntry(
    entry.id,
    "accept",
    "policy: advance",
    { expectedStage: "Screened", expectedApprovalKind: null, actor: "system" }
  );

  assert.equal(result, null, "the stale system advance must be skipped, not consume the review");
  const fresh = getPipelineEntry(entry.id)!;
  assert.equal(fresh.stage, "Screened", "the review must still be pending at its original stage");
  assert.equal(fresh.approvalKind, "screening_review", "the screening_review gate must not be auto-resolved to calendar");
});

test("the system advance still applies when the approval state is UNCHANGED (no false refusals)", () => {
  const entry = addEntry(); // approvalKind null, unchanged through the hop

  const result = actOnPipelineEntry(
    entry.id,
    "accept",
    "policy: advance",
    { expectedStage: "Screened", expectedApprovalKind: null, actor: "system" }
  );

  assert.ok(result, "an unchanged snapshot must advance normally");
  assert.equal(result!.stage, "Interview", "Screened → Interview");
  const advances = listPipelineEventsForEntry(entry.id).filter((e) => e.kind === "auto_advanced");
  assert.equal(advances.length, 1, "the engine advance is recorded as auto_advanced");
});

test("human routes (no expectedApprovalKind) are unaffected by the new guard", () => {
  const entry = addEntry();
  // A recruiter clicking a screening_review accept passes no approval expectation —
  // the guard is inert (undefined) and the gate resolves as before.
  setApproval(entry.id, "screening_review", JSON.stringify({ recommendation: "advance" }));
  const moved = actOnPipelineEntry(entry.id, "accept"); // human, no opts
  assert.ok(moved, "a human accept with no snapshot expectation still applies");
  assert.equal(moved!.stage, "Interview");
  assert.equal(moved!.approvalKind, "calendar", "the human screening accept opens the calendar as designed");
});
