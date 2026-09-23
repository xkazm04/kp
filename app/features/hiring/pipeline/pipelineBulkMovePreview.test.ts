// blast-radius-computation — the bulk move says what it sets off before it fires
// (challenge-r06 pipeline-move-bulk-operations/B). The server previews each row with
// the planner the arrival hook executes (app/_lib/pipeline-arrival-plan.ts); this
// module folds those rows into the sentence the bar shows, decides whether the move
// needs a confirm, and builds the commit from EXACTLY what was previewed.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  commitItemsFromPreview,
  movePreviewParts,
  needsConfirm,
  summarizeMovePreview,
  type MovePreviewRow,
} from "./pipelineBulkMovePreview.ts";
import {
  EMPTY_BULK_SELECTION,
  armedBulkConfirm,
  bulkSelectionReducer,
  cohortSignature,
} from "./pipelineBulkSelection.ts";

const row = (id: string, effect: string, over: Partial<{ clears: string | null; holdBack: boolean; stage: string }> = {}): MovePreviewRow => ({
  id,
  ok: true,
  preview: { effect: effect as never, clears: over.clears ?? null, holdBack: over.holdBack ?? false, stage: over.stage ?? "Screened" },
});

const EIGHT: MovePreviewRow[] = [
  row("a", "ai_invite"),
  row("b", "ai_invite"),
  row("c", "ai_invite_held"),
  row("d", "plain"),
  row("e", "plain", { clears: "scorecard_review", stage: "Interview" }),
  row("f", "noop", { stage: "Interview" }),
  row("g", "noop", { stage: "Interview" }),
  row("h", "plain", { clears: "offer_review", holdBack: true, stage: "Offer" }),
];

test("summarizeMovePreview counts what the move sets off; a consequential preview needs a confirm", () => {
  const s = summarizeMovePreview(EIGHT);
  assert.deepEqual(s, {
    moving: 5,
    alreadyThere: 2,
    invitesNow: 2,
    invitesHeld: 1,
    homework: 0,
    offersHeld: 1,
    verdictsCleared: 1,
    stale: 0,
  });
  assert.equal(needsConfirm(s), true);
  const allPlain = summarizeMovePreview([row("x", "plain"), row("y", "plain"), row("z", "noop")]);
  assert.equal(needsConfirm(allPlain), false, "one click still commits a move that sets nothing off");
  // The sentence names every non-zero consequence, and only those.
  assert.deepEqual(
    movePreviewParts(s).map((p) => p.key),
    ["bulkMovePreviewMoving", "bulkMovePreviewInvitesNow", "bulkMovePreviewInvitesHeld", "bulkMovePreviewVerdictsCleared", "bulkMovePreviewOffersHeld", "bulkMovePreviewAlreadyThere"]
  );
});

test("commitItemsFromPreview holds offer drafts back and pins each row to its previewed stage", () => {
  const selection = new Set(["a", "b", "c", "d", "e", "f", "g", "h"]);
  const plan = commitItemsFromPreview({ toStage: "Interview", rows: EIGHT }, selection);
  assert.deepEqual(plan.heldBack, ["h"], "the drafted offer stays selected, not moved");
  assert.deepEqual(plan.alreadyThere, ["f", "g"]);
  assert.deepEqual(
    plan.items.map((i) => i.id),
    ["a", "b", "c", "d", "e"]
  );
  for (const it of plan.items) {
    assert.equal(it.action, "set_stage");
    assert.equal(it.toStage, "Interview");
  }
  assert.equal(plan.items.find((i) => i.id === "e")!.expectedStage, "Interview", "the previewed stage is the CAS, so a row that moved since is a per-id 409");
  assert.equal(plan.items.find((i) => i.id === "a")!.expectedStage, "Screened");
  // A row the recruiter no longer has selected is never committed.
  assert.deepEqual(commitItemsFromPreview({ toStage: "Interview", rows: EIGHT }, new Set(["a"])).items.map((i) => i.id), ["a"]);
  // A row the preview refused rides as a per-id failure with its code, never a commit.
  const refused = commitItemsFromPreview(
    { toStage: "Interview", rows: [{ id: "q", ok: false, code: "PIPELINE_MOVE_CONFLICT" }] },
    new Set(["q"])
  );
  assert.deepEqual(refused.items, []);
  assert.deepEqual(refused.refused, [{ id: "q", ok: false, code: "PIPELINE_MOVE_CONFLICT" }]);
});

// The move confirm lives in the reducer's ONE confirm slot and signs its cohort AND
// its target: re-pointing the Move-to select after the preview re-previews.
const entries = [
  { id: "a", stage: "Screened", approvalKind: null, status: "active" },
  { id: "b", stage: "Screened", approvalKind: null, status: "active" },
];

test("an armed move confirm is disarmed by a new target or a re-staged row", () => {
  const selected = new Set(["a", "b"]);
  let s = bulkSelectionReducer(EMPTY_BULK_SELECTION, { type: "selectAll", ids: ["a", "b"] });
  s = bulkSelectionReducer(s, {
    type: "previewed",
    preview: { toStage: "Interview", rows: [row("a", "ai_invite"), row("b", "plain")] },
    arm: { scope: "S", cohort: cohortSignature(selected, entries, "move", "Interview") },
  });
  assert.equal(armedBulkConfirm(s, "S", entries, "Interview"), "move");
  assert.equal(s.result?.verb, "previewed", "the preview sentence is the status line");
  assert.equal(armedBulkConfirm(s, "S", entries, "Offer"), null, "a different target was never previewed");
  const drifted = [entries[0], { ...entries[1], stage: "Interview" }];
  assert.equal(armedBulkConfirm(s, "S", drifted, "Interview"), null, "a row moved since the preview");
  // A selection change drops the confirm and the preview with it.
  const toggled = bulkSelectionReducer(s, { type: "toggle", id: "b" });
  assert.equal(toggled.confirm, null);
  assert.equal(toggled.movePreview, null);
});

test("a reject confirm cannot be armed by a move signature, and vice versa", () => {
  const selected = new Set(["a", "b"]);
  assert.notEqual(cohortSignature(selected, entries, "move", "Interview"), cohortSignature(selected, entries, "outreach"));
});
