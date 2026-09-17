// Locks the candidate portal's card choice so a live in_progress session is a
// busy card, not Start. /connect already refuses INTERVIEW_ALREADY_LIVE; the
// page used to mount VoiceInterviewClient anyway.
//
// Runner: node --test with type stripping (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import { LIVE_INTERVIEW_RECENCY_MIN } from "@/app/_lib/db/interviews.ts";
import { interviewPortalView } from "./portal-state.ts";

function iso(msAgo: number): string {
  return new Date(Date.now() - msAgo).toISOString();
}

test("a live in_progress session is the busy card, not Start", () => {
  assert.equal(
    interviewPortalView({
      status: "in_progress",
      createdAt: iso(5 * 60_000),
      updatedAt: iso(60_000),
    }),
    "live",
  );
});

test("a stale in_progress session past the recency window is still Start", () => {
  assert.equal(
    interviewPortalView({
      status: "in_progress",
      createdAt: iso((LIVE_INTERVIEW_RECENCY_MIN + 5) * 60_000),
      updatedAt: iso((LIVE_INTERVIEW_RECENCY_MIN + 1) * 60_000),
    }),
    "ready",
  );
});

test("a failed session is Start — failed stays reconnectable", () => {
  assert.equal(
    interviewPortalView({
      status: "failed",
      createdAt: iso(5 * 60_000),
      updatedAt: iso(60_000),
    }),
    "ready",
  );
});

test("completed and revoked keep their closed cards", () => {
  assert.equal(
    interviewPortalView({ status: "completed", createdAt: iso(60_000), updatedAt: iso(1_000) }),
    "completed",
  );
  assert.equal(
    interviewPortalView({ status: "revoked", createdAt: iso(60_000), updatedAt: iso(1_000) }),
    "inactive",
  );
});
