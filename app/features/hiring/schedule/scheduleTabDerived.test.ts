// The Schedule tab's two derived lists (/perfect 2026-09-03, schedule-ui-2). Both were
// untested inline useMemo bodies; both decide what the recruiter can see and book over.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bookedMarkersFrom, interviewedEntriesFrom } from "./scheduleTabDerived.ts";
import { isoToDateSlot } from "@/app/_lib/schedule-slots";
import type { ScheduleInvite } from "@/app/_lib/schedule-store";
import type { SchedEntry } from "./ScheduleTypes.ts";

const SLOT_AT = "2026-10-06T12:00:00.000Z";
const CELL = isoToDateSlot(SLOT_AT)!;

function invite(over: Partial<ScheduleInvite>): ScheduleInvite {
  return {
    token: "tok",
    status: "confirmed",
    slotAt: SLOT_AT,
    entryId: null,
    candidateLabel: "Cand",
    ...over,
  } as ScheduleInvite;
}

test("a confirmed invite with no pending entry occupies its cell", () => {
  // The whole point of the list: a candidate who self-booked has usually advanced out
  // of the pending list, so without this nothing would show their hour and the
  // recruiter would book straight over it.
  const markers = bookedMarkersFrom([invite({ token: "self-booked" })], new Set());
  assert.deepEqual(markers, [{ id: "self-booked", dateSlot: CELL, candidateLabel: "Cand" }]);
});

test("an entry already drawn as an assignable chip is not drawn twice", () => {
  const markers = bookedMarkersFrom([invite({ token: "t", entryId: "e1" })], new Set(["e1"]));
  assert.deepEqual(markers, []);
});

test("only CONFIRMED invites with a resolvable instant occupy a cell", () => {
  const markers = bookedMarkersFrom(
    [
      invite({ token: "pending", status: "pending", slotAt: null }),
      invite({ token: "cancelled", status: "cancelled" }),
      invite({ token: "unparseable", slotAt: "not-a-time" }),
      invite({ token: "good" }),
    ],
    new Set()
  );
  assert.deepEqual(markers.map((m) => m.id), ["good"]);
});

test("a confirmed invite with no candidate label still occupies its cell", () => {
  // Dropping it would free an hour that is genuinely taken — an em dash is the right
  // answer, an absent marker is not.
  const [m] = bookedMarkersFrom([invite({ candidateLabel: null })], new Set());
  assert.equal(m.candidateLabel, "—");
});

const entry = (id: string, approvalKind: string): SchedEntry => ({ id, approvalKind, candidateLabel: id } as SchedEntry);

test("interviewed = past scheduling AND (a transcript OR a human scorecard)", () => {
  const entries = [
    entry("voice", "scorecard_review"),
    entry("human-led", "scorecard_review"),
    entry("no-signal", "scorecard_review"),
    entry("still-scheduling", "calendar"),
  ];
  const out = interviewedEntriesFrom(
    entries,
    { voice: { hasTranscript: true }, "still-scheduling": { hasTranscript: true } },
    { "human-led": { hasHumanScorecard: true } }
  );
  // The one that keeps being forgotten is "human-led": a human round produces no
  // transcript, so a transcript-only test made every human-led candidate — and the
  // prep modal holding their scorecard — vanish the moment the verdict gated the entry.
  assert.deepEqual(out.map((e) => e.id), ["voice", "human-led"]);
});

test("a candidate still awaiting a slot is never listed as interviewed", () => {
  const out = interviewedEntriesFrom([entry("x", "calendar")], { x: { hasTranscript: true } }, { x: { hasHumanScorecard: true } });
  assert.deepEqual(out, []);
});

test("an entry with no status row at all is not interviewed", () => {
  assert.deepEqual(interviewedEntriesFrom([entry("x", "scorecard_review")], {}, {}), []);
});

test("acceptance 112: active interview entry with approvalKind null and unscored session IS listed and tagged unscored", () => {
  const now = 1_000_000_000_000;
  const tenMinAgo = new Date(now - 10 * 60 * 1000).toISOString();
  const entries = [
    { id: "e1", approvalKind: null, candidateLabel: "Cand 1", status: "active", stage: "Interview" } as SchedEntry,
  ];
  const out = interviewedEntriesFrom(
    entries,
    {
      e1: {
        status: "completed",
        hasTranscript: true,
        hasScorecard: false,
        mode: "candidate",
        endedAt: tenMinAgo,
      },
    },
    {},
    now
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "e1");
  assert.equal(out[0].scoringState, "unscored");
});

test("acceptance 113: scorecard_review with scored session or human scorecard is listed and tagged scored", () => {
  const now = 1_000_000_000_000;
  const entries = [
    { id: "ai-scored", approvalKind: "scorecard_review", candidateLabel: "AI" } as SchedEntry,
    { id: "human-scored", approvalKind: "scorecard_review", candidateLabel: "Human" } as SchedEntry,
  ];
  const out = interviewedEntriesFrom(
    entries,
    {
      "ai-scored": {
        status: "completed",
        hasTranscript: true,
        hasScorecard: true,
        mode: "candidate",
      },
    },
    {
      "human-scored": { hasHumanScorecard: true },
    },
    now
  );
  assert.deepEqual(
    out.map((e) => ({ id: e.id, scoringState: e.scoringState })),
    [
      { id: "ai-scored", scoringState: "scored" },
      { id: "human-scored", scoringState: "scored" },
    ]
  );
});
