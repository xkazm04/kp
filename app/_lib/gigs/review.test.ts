// The review desk's actions (review.ts) on an isolated throwaway DB, with an injected
// Personas transport for `revise`. unit-db.ts first.
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { getGig } from "../db/gigs.ts";
import { getGigAttempt, listGigAttemptsForGig } from "../db/gigs-attempts.ts";
import { GIG_DISCLOSURE_ITEM, type GigAssignment } from "./types.ts";
import { applyGigReview, normalizeGigReview } from "./review.ts";
import type { DispatchGigDeps } from "./dispatch.ts";
import { fixtureDraftedGig, fixtureSpecialist } from "./__fixtures__/sent-gig.ts";

after(() => cleanupUnitDb());

const WS = "ws-gig-review";

function transport(): { deps: DispatchGigDeps; calls: GigAssignment[] } {
  const calls: GigAssignment[] = [];
  return {
    calls,
    deps: {
      executePersona: async (_personaId, assignment) => {
        calls.push(assignment);
        return { ok: true, executionId: `exec-${calls.length}` };
      },
    },
  };
}

test("normalizeGigReview keeps boolean ticks with key-shaped names, bounds the note, drops junk", () => {
  const now = new Date("2026-09-24T10:00:00Z");
  const r = normalizeGigReview({ checklist: { disclosure: true, tests_pass: "yes", "Bad Key": true, scoped_change: false }, note: "  fine  ", reviewMs: 1234.6 }, now)!;
  assert.deepEqual(r.checklist, { disclosure: true, scoped_change: false });
  assert.equal(r.note, "fine");
  assert.equal(r.reviewMs, 1235);
  assert.equal(r.reviewedAt, now.toISOString());
  assert.equal(normalizeGigReview(null), null);
  assert.equal(normalizeGigReview([1, 2]), null);
  assert.equal(normalizeGigReview({ reviewMs: -1 })!.reviewMs, null);
});

test("approve: attempt drafted -> approved with the review; gig drafted -> in_review", async () => {
  const spec = fixtureSpecialist(WS, "oss_bounty");
  const { gig, attempt } = fixtureDraftedGig(WS, spec);
  const r = await applyGigReview(WS, attempt.id, "approve", { checklist: { tests_pass: true }, reviewMs: 5000 });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.attempt.status, "approved");
  assert.deepEqual(r.attempt.review?.checklist, { tests_pass: true });
  assert.equal(r.gig?.status, "in_review");
  // Approving twice is not an action an approved attempt starts from.
  assert.deepEqual(await applyGigReview(WS, attempt.id, "approve", null), { ok: false, code: "GIG_ACTION_NOT_ALLOWED", detail: "approved" });
  assert.equal(getGig(WS, gig.id)!.status, "in_review");
});

test("mark_sent: refused without the disclosure tick; the stored review counts; sent stamps sentAt", async () => {
  const spec = fixtureSpecialist(WS, "oss_bounty");
  const { gig, attempt } = fixtureDraftedGig(WS, spec);
  // Sending straight from drafted is not allowed - approval comes first.
  assert.equal((await applyGigReview(WS, attempt.id, "mark_sent", { checklist: { [GIG_DISCLOSURE_ITEM]: true } })).ok, false);
  await applyGigReview(WS, attempt.id, "approve", { checklist: { tests_pass: true } });
  assert.deepEqual(await applyGigReview(WS, attempt.id, "mark_sent", null), { ok: false, code: "GIG_DISCLOSURE_REQUIRED" });
  assert.deepEqual(await applyGigReview(WS, attempt.id, "mark_sent", { checklist: { [GIG_DISCLOSURE_ITEM]: false } }), {
    ok: false,
    code: "GIG_DISCLOSURE_REQUIRED",
  });
  assert.equal(getGigAttempt(WS, attempt.id)!.status, "approved", "a refused send writes nothing");
  const sent = await applyGigReview(WS, attempt.id, "mark_sent", { checklist: { tests_pass: true, [GIG_DISCLOSURE_ITEM]: true }, reviewMs: 60_000 });
  assert.ok(sent.ok);
  if (!sent.ok) return;
  assert.equal(sent.attempt.status, "sent");
  assert.ok(sent.attempt.sentAt);
  assert.equal(sent.attempt.review?.checklist[GIG_DISCLOSURE_ITEM], true, "the review that authorised the send is stored");
  assert.equal(sent.gig?.status, "sent");
  assert.equal(getGig(WS, gig.id)!.status, "sent");

  // The review stored at approve is enough when it already ticked the disclosure.
  const other = fixtureDraftedGig(WS, spec);
  await applyGigReview(WS, other.attempt.id, "approve", { checklist: { [GIG_DISCLOSURE_ITEM]: true } });
  const viaStored = await applyGigReview(WS, other.attempt.id, "mark_sent", null);
  assert.ok(viaStored.ok && viaStored.attempt.status === "sent");
});

test("mark_sent refuses when the gig is no longer waiting on this review", async () => {
  const spec = fixtureSpecialist(WS, "freelance");
  const { attempt } = fixtureDraftedGig(WS, spec);
  // Approved while the gig stayed `drafted` (as if its own move had been lost).
  const { transitionGigAttempt } = await import("../db/gigs-attempts.ts");
  transitionGigAttempt(WS, attempt.id, { from: "drafted", to: "approved", patch: { review: normalizeGigReview({ checklist: { disclosure: true } }) } });
  assert.deepEqual(await applyGigReview(WS, attempt.id, "mark_sent", null), { ok: false, code: "GIG_ACTION_NOT_ALLOWED", detail: "drafted" });
});

test("discard: the attempt is discarded and the gig returns to qualified (still workable)", async () => {
  const spec = fixtureSpecialist(WS, "security");
  const { gig, attempt } = fixtureDraftedGig(WS, spec);
  await applyGigReview(WS, attempt.id, "approve", null);
  const r = await applyGigReview(WS, attempt.id, "discard", { note: "wrong scope" });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.attempt.status, "discarded");
  assert.equal(r.attempt.review?.note, "wrong scope");
  assert.equal(getGig(WS, gig.id)!.status, "qualified");
});

test("revise: a note is required; the revised attempt ends, and a NEW attempt carries the note to Personas", async () => {
  const spec = fixtureSpecialist(WS, "oss_bounty");
  const { gig, attempt } = fixtureDraftedGig(WS, spec);
  const t = transport();
  assert.deepEqual(await applyGigReview(WS, attempt.id, "revise", { checklist: {} }, { dispatch: t.deps }), {
    ok: false,
    code: "GIG_REVISION_NOTE_REQUIRED",
  });
  assert.equal(t.calls.length, 0);
  const r = await applyGigReview(WS, attempt.id, "revise", { note: "Add a regression test for the race." }, { dispatch: t.deps });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.attempt.status, "revision_requested");
  assert.equal(r.attempt.revisionNote, "Add a regression test for the race.");
  assert.ok(r.dispatch?.ok);
  assert.equal(t.calls.length, 1);
  assert.equal(t.calls[0].revisionNote, "Add a regression test for the race.");
  const attempts = listGigAttemptsForGig(WS, gig.id);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[1].revisionNote, "Add a regression test for the race.");
  assert.equal(attempts[1].executionId, "exec-1");
  assert.equal(getGig(WS, gig.id)!.status, "dispatched");
});

test("revise whose re-dispatch is refused keeps the revision request and reports the dispatch code", async () => {
  // A specialist whose hire is not running yet: the dispatch refuses before any network.
  const spec = fixtureSpecialist(WS, "competition", "pending_approval", null);
  const { gig, attempt } = fixtureDraftedGig(WS, spec);
  const t = transport();
  const r = await applyGigReview(WS, attempt.id, "revise", { note: "Report the local CV score." }, { dispatch: t.deps });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.attempt.status, "revision_requested");
  assert.equal(r.dispatch?.ok, false);
  assert.equal(r.dispatch && !r.dispatch.ok ? r.dispatch.code : null, "GIG_SPECIALIST_NOT_READY");
  assert.equal(t.calls.length, 0);
  assert.equal(getGig(WS, gig.id)!.status, "drafted", "the gig is still waiting for a re-dispatch");
});

test("an unknown attempt, or another tenant's, is GIG_ATTEMPT_NOT_FOUND", async () => {
  assert.deepEqual(await applyGigReview(WS, "gatt-nope", "approve", null), { ok: false, code: "GIG_ATTEMPT_NOT_FOUND" });
  const spec = fixtureSpecialist(WS, "security");
  const { attempt } = fixtureDraftedGig(WS, spec);
  assert.deepEqual(await applyGigReview("ws-someone-else", attempt.id, "approve", null), { ok: false, code: "GIG_ATTEMPT_NOT_FOUND" });
});
