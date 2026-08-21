// The Decisions queue's population rule. The header count, the role-filter counts
// and the "all caught up" empty state are all computed from ONE list of pending
// entries; this pins which entries belong in it.
//
// The defect it locks out: the queue used to admit any active entry carrying ANY
// approvalKind, while the tab renders only "decision" + the four *_review kinds.
// "calendar" — the interview-scheduling gate the Schedule tab owns — is set by THIS
// tab's own accept path, so accepting a screening card left the header reading
// "3 pending" over 2 cards and the role dropdown reading "Backend Dev (3)"; a role
// down to nothing but calendar entries never reached "You're all caught up."
//
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { isDecisionsQueueEntry, roleKeyOf, DECISIONS_QUEUE_KINDS } from "./decisionsQueueTypes.ts";
import type { Entry } from "@/app/features/shared/decisionsTypes";

const e = (over: Partial<Entry>): Entry => ({
  id: "e1",
  candidateId: "c1",
  candidateLabel: "Alice",
  archetype: null,
  roleFamily: null,
  jobId: "jd-backend",
  jobTitle: "Backend Dev",
  stage: "Screened",
  matchScore: 50,
  status: "active",
  approvalKind: null,
  approvalDetail: null,
  ...over,
});

test("every kind the tab renders as a card counts as pending", () => {
  for (const kind of DECISIONS_QUEUE_KINDS) {
    assert.equal(isDecisionsQueueEntry(e({ approvalKind: kind })), true, `${kind} is decided on this tab`);
  }
});

test("the Schedule tab's calendar gate is NOT a decision pending here", () => {
  // The exact regression: accepting a screening review flips approvalKind to
  // "calendar" server-side (the handoff the queued-for-Schedule banner narrates), so
  // the accepted candidate stayed in this tab's count with no card to show for it.
  assert.equal(isDecisionsQueueEntry(e({ approvalKind: "calendar" })), false);
  const afterAcceptingOneOfThree = [
    e({ id: "a", approvalKind: "calendar" }), // just accepted → now the Schedule tab's
    e({ id: "b", approvalKind: "screening_review" }),
    e({ id: "c", approvalKind: "decision" }),
  ];
  assert.equal(afterAcceptingOneOfThree.filter(isDecisionsQueueEntry).length, 2, "the header count must match the two rendered cards");
});

test("a role left with only calendar entries empties the queue (the caught-up state is reachable)", () => {
  const entries = [e({ id: "a", approvalKind: "calendar" }), e({ id: "b", approvalKind: "calendar" })];
  assert.deepEqual(entries.filter(isDecisionsQueueEntry), []);
});

test("gated on an ACTIVE status and a recognized kind", () => {
  assert.equal(isDecisionsQueueEntry(e({ approvalKind: "decision", status: "rejected" })), false, "a closed entry never pends");
  assert.equal(isDecisionsQueueEntry(e({ approvalKind: null })), false, "no gate → nothing to decide");
  assert.equal(isDecisionsQueueEntry(e({ approvalKind: "screening_reviewww" })), false, "an unrecognized kind is not a gate this tab renders");
});

test("roleKeyOf prefers the job id, then the title, then the unassigned bucket", () => {
  assert.equal(roleKeyOf(e({})), "jd-backend");
  assert.equal(roleKeyOf(e({ jobId: null })), "Backend Dev");
  assert.equal(roleKeyOf(e({ jobId: null, jobTitle: null })), "unassigned");
});
