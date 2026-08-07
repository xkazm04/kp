// Real-DB coverage for the EXPLICIT role-reopen transition (job-postings-lifecycle
// #1). Reopening a closed role must deterministically restore the entries THAT
// close withdrew — at their preserved pre-close stage, independent of whether
// re-sourcing ever runs or matches anyone — and leave an audit trail, WITHOUT
// resurrecting a candidate a human rejected on merit before the role closed.
//
// unit-db.ts MUST be the first project import (it sets KP_DB_PATH so every store
// opens a throwaway SQLite file unique to this process).
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  actOnPipelineEntry,
  closeEntriesByJobId,
  createPipelineEntry,
  getPipelineEntry,
  hasEvent,
  reopenEntriesByJobId,
  setPipelineEntryStage,
} from "./pipeline.ts";

after(() => cleanupUnitDb());

test("reopening a closed role restores its role-closed entries (no sourcing) at their pre-close stage and emits role_reopened, never a pre-close human reject", () => {
  const jobId = "reopen-job-1";

  // Two candidates in the role. Advance B one stage so we can prove the pre-close
  // STAGE survives the close→reopen round-trip (close flips status, never stage).
  const a = createPipelineEntry({ candidateId: "cand-a", candidateLabel: "Cand A", jobId, jobTitle: "Backend Eng", stage: "Screened" }).entry;
  const b = createPipelineEntry({ candidateId: "cand-b", candidateLabel: "Cand B", jobId, jobTitle: "Backend Eng", stage: "Screened" }).entry;
  const movedB = setPipelineEntryStage(b.id, "Interview");
  assert.equal(movedB?.stage, "Interview");

  // A third candidate the recruiter REJECTED on merit BEFORE the role closed — a
  // DIFFERENT terminal reason that a reopen must not touch.
  const c = createPipelineEntry({ candidateId: "cand-c", candidateLabel: "Cand C", jobId, jobTitle: "Backend Eng", stage: "Screened" }).entry;
  actOnPipelineEntry(c.id, "reject");
  assert.equal(getPipelineEntry(c.id)!.status, "rejected");

  // Close the role: A and B are withdrawn (role_closed); C stays rejected.
  const withdrawn = closeEntriesByJobId(jobId);
  assert.equal(withdrawn, 2);
  assert.equal(getPipelineEntry(a.id)!.status, "role_closed");
  assert.equal(getPipelineEntry(b.id)!.status, "role_closed");
  assert.equal(getPipelineEntry(c.id)!.status, "rejected");

  // Reopen — a pure store transition, ZERO sourcing involved. This is exactly the
  // "sourcing is a no-op" condition: the restore must be complete on its own.
  const reopened = reopenEntriesByJobId(jobId);
  assert.equal(reopened, 2, "both role-closed entries restored regardless of sourcing");

  const ra = getPipelineEntry(a.id)!;
  const rb = getPipelineEntry(b.id)!;
  assert.equal(ra.status, "active");
  assert.equal(rb.status, "active");
  assert.equal(ra.stage, "Screened", "pre-close stage preserved");
  assert.equal(rb.stage, "Interview", "pre-close stage preserved (non-default)");

  // The human merit-reject is NOT resurrected.
  assert.equal(getPipelineEntry(c.id)!.status, "rejected");

  // Audit trail: a role_reopened event on each restored entry; none on the reject.
  assert.equal(hasEvent(a.id, "role_reopened"), true);
  assert.equal(hasEvent(b.id, "role_reopened"), true);
  assert.equal(hasEvent(c.id, "role_reopened"), false);

  // Idempotent: a second reopen has nothing role_closed left to restore.
  assert.equal(reopenEntriesByJobId(jobId), 0);
});
