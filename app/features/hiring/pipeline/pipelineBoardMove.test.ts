// The board's optimistic-move machine (pipelineBoardMove.ts). These pin the three
// paths a drag can take and the two ways the merge used to be wrong: a whole-object
// swap that blanked the card's score stamps, and a rollback that drifts from the move
// it undoes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeMovedRow, moveOutcome, restageEntries, shouldCommitBoard } from "./pipelineBoardMove.ts";
import type { Entry } from "@/app/features/shared/pipelineTypes";

const entry = (over: Partial<Entry> = {}): Entry =>
  ({
    id: "e1",
    stage: "Screened",
    status: "active",
    candidateLabel: "Ada",
    jobTitle: "Backend",
    canonicalScore: 82,
    approvalKind: "screening",
    approvalDetail: "held",
    stageChangedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  }) as unknown as Entry;

test("a refusal rolls back; a 2xx with a usable row applies; a 2xx without one reconciles", () => {
  assert.deepEqual(moveOutcome(false, { stage: "Interview" }), { kind: "rollback" }, "a refusal never trusts its body");
  assert.deepEqual(moveOutcome(true, { stage: "Interview" }), { kind: "applied", entry: { stage: "Interview" } });
  assert.deepEqual(moveOutcome(true, null), { kind: "reconcile" }, "no body means don't trust the optimistic write");
  assert.deepEqual(moveOutcome(true, {}), { kind: "reconcile" }, "a row with no stage is not a usable row");
  assert.deepEqual(moveOutcome(true, { stage: undefined }), { kind: "reconcile" });
});

test("restage is its own inverse — the rollback cannot drift from the move", () => {
  const board = [entry(), entry({ id: "e2", stage: "Applied" })];
  const moved = restageEntries(board, "e1", "Interview")!;
  assert.equal(moved[0]!.stage, "Interview");
  assert.equal(moved[1], board[1], "untouched cards keep their identity");
  const back = restageEntries(moved, "e1", "Screened")!;
  assert.deepEqual(back[0], board[0]);
});

test("restage returns the SAME array when nothing changes (no needless re-bucketing)", () => {
  const board = [entry()];
  assert.equal(restageEntries(board, "e1", "Screened"), board, "already at the target");
  assert.equal(restageEntries(board, "missing", "Interview"), board, "a card that vanished");
  assert.equal(restageEntries(null, "e1", "Interview"), null);
});

test("the merge takes only what a set_stage can change — the score stamps survive", () => {
  const board = [entry()];
  const next = mergeMovedRow(board, "e1", {
    stage: "Interview",
    status: "active",
    stageChangedAt: "2026-02-02T00:00:00.000Z",
  } as Partial<Entry>)!;
  assert.equal(next[0]!.stage, "Interview");
  assert.equal(next[0]!.stageChangedAt, "2026-02-02T00:00:00.000Z");
  // The route answers the raw store row, not the board projection: a whole-object
  // swap blanked this and visibly changed the card's badge.
  assert.equal(next[0]!.canonicalScore, 82, "the projection's score stamp is kept");
  assert.equal(next[0]!.candidateLabel, "Ada");
});

test("an absent approval on the moved row CLEARS it — a move can end the wait", () => {
  const next = mergeMovedRow([entry()], "e1", { stage: "Interview" } as Partial<Entry>)!;
  assert.equal(next[0]!.approvalKind, null);
  assert.equal(next[0]!.approvalDetail, null);
  const held = mergeMovedRow([entry()], "e1", { stage: "Interview", approvalKind: "offer" } as Partial<Entry>)!;
  assert.equal(held[0]!.approvalKind, "offer");
});

test("the poll's content gate commits a first load and every genuine change", () => {
  assert.equal(shouldCommitBoard("sig-a", null), true, "nothing committed yet");
  assert.equal(shouldCommitBoard("sig-a", "sig-a"), false, "a quiet poll writes nothing");
  assert.equal(shouldCommitBoard("sig-b", "sig-a"), true);
});
