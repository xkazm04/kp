// The store guard in actOnPipelineEntry: the terminal (Hired) column is outcome-bearing,
// so an accept / screening_review that would LAND on it is refused unless the caller
// declares `outcome: "offer_accepted"`; approve_event never lands there at all.
//
// The census (pipeline-stage-writers.test.ts) used to list four callers as known-gap
// because a composed board with no interview and no offer column puts the terminal
// column right after the screening one. validatePipelineStages allows that board, so the
// door is closed in the store, not by narrowing the board.
// (testing/unit-db.ts must be the first project import.)
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { actOnPipelineEntry, createPipelineEntry, getPipelineEntry, listPipelineEventsForEntry, setApproval, setPipelineEntryStage } from "./pipeline.ts";
import { setDecisionConfig } from "../decision-config-store.ts";
import { registerStageEnteredHook, _resetStageEnteredHookForTests, type StageEnteredNotification } from "../stage-hook-registry.ts";

after(() => {
  _resetStageEnteredHookForTests();
  cleanupUnitDb();
});

const WS_BARE = "team-bare-axis";
const WS_DEFAULT = "team-default-axis";

// entry, then a screening-role column, then terminal: no interview, no offer.
setDecisionConfig(
  "pipelineStages",
  {
    stages: [
      { id: "Inbox", label: "Inbox", role: "entry" },
      { id: "Review", label: "Review", role: "screening" },
      { id: "Signed", label: "Signed", role: "terminal" },
    ],
    retired: [],
  },
  WS_BARE
);

let seen: StageEnteredNotification[] = [];
beforeEach(() => {
  seen = [];
  registerStageEnteredHook((n) => seen.push(n));
});

let seq = 0;
function entryAt(stage: string, ws: string) {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `act-term-c${seq}`,
    candidateLabel: `Act Terminal ${seq}`,
    jobId: "act-term-job",
    jobTitle: "Act terminal role",
    workspaceId: ws,
  });
  assert.ok(setPipelineEntryStage(entry.id, stage, undefined, ws), "precondition: staged");
  seen = []; // the staging above fired the arrival hook; the assertions below are about the act
  return entry.id;
}
const events = (id: string, ws: string) => listPipelineEventsForEntry(id, 50, ws);

test("a system accept from the column before terminal is refused: no move, no event, no hook", () => {
  const id = entryAt("Review", WS_BARE);
  const before = events(id, WS_BARE).length;
  const r = actOnPipelineEntry(id, "accept", undefined, { actor: "system" }, WS_BARE);
  assert.equal(r, null);
  assert.equal(getPipelineEntry(id, WS_BARE)!.stage, "Review");
  assert.equal(events(id, WS_BARE).length, before, "nothing written");
  assert.deepEqual(seen, [], "the arrival hook did not fire");
});

test("the screening_review branch is refused the same way", () => {
  const id = entryAt("Review", WS_BARE);
  setApproval(id, "screening_review", "{}", WS_BARE);
  const before = events(id, WS_BARE).length;
  const r = actOnPipelineEntry(id, "accept", undefined, { actor: "system", expectedApprovalKind: "screening_review" }, WS_BARE);
  assert.equal(r, null);
  const after = getPipelineEntry(id, WS_BARE)!;
  assert.equal(after.stage, "Review");
  assert.equal(after.approvalKind, "screening_review", "the review is still pending");
  assert.equal(events(id, WS_BARE).length, before);
  assert.deepEqual(seen, []);
});

test("with the offer_accepted opt-in the same accept lands on terminal", () => {
  const id = entryAt("Review", WS_BARE);
  const r = actOnPipelineEntry(id, "accept", undefined, { actor: "system", outcome: "offer_accepted" }, WS_BARE);
  assert.equal(r?.stage, "Signed");
  assert.equal(events(id, WS_BARE).filter((e) => e.kind === "auto_advanced" && e.toStage === "Signed").length, 1);
  assert.equal(seen.length, 1);
});

test("approve_event on the bare axis confirms the slot, keeps the stage, clears the approval, writes one 'scheduled' event", () => {
  const id = entryAt("Review", WS_BARE);
  setApproval(id, "calendar", "Tue 14:00", WS_BARE);
  const r = actOnPipelineEntry(id, "approve_event", "Wed 10:00", undefined, WS_BARE);
  assert.ok(r, "the slot is confirmed, not refused");
  assert.equal(r!.stage, "Review");
  assert.equal(r!.approvalKind, null);
  const scheduled = events(id, WS_BARE).filter((e) => e.kind === "scheduled");
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].toStage, "Review");
  assert.equal(scheduled[0].detail, "Wed 10:00");
  assert.deepEqual(seen, [], "no arrival");
});

test("shipped default axis: accept from Screened lands on Interview, approve_event lands on Interview", () => {
  const a = entryAt("Screened", WS_DEFAULT);
  assert.equal(actOnPipelineEntry(a, "accept", undefined, { actor: "system" }, WS_DEFAULT)?.stage, "Interview");
  const b = entryAt("Screened", WS_DEFAULT);
  setApproval(b, "calendar", "Tue 14:00", WS_DEFAULT);
  assert.equal(actOnPipelineEntry(b, "approve_event", undefined, undefined, WS_DEFAULT)?.stage, "Interview");
});

test("shipped default axis: the offer accept lands on Hired only through the opt-in", () => {
  const a = entryAt("Offer", WS_DEFAULT);
  assert.equal(actOnPipelineEntry(a, "accept", undefined, { actor: "system" }, WS_DEFAULT), null);
  assert.equal(getPipelineEntry(a, WS_DEFAULT)!.stage, "Offer");
  assert.equal(actOnPipelineEntry(a, "accept", undefined, { actor: "system", outcome: "offer_accepted" }, WS_DEFAULT)?.stage, "Hired");
});
