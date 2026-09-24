// Behaviour of the gig attempt store on an isolated throwaway DB - unit-db.ts must be the
// first project import.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import type { GigDeliverable, GigReview } from "../gigs/types.ts";
import { upsertGigFromRaw } from "./gigs.ts";
import {
  createGigAttempt,
  getGigAttempt,
  listGigAttemptsByStatus,
  listGigAttemptsForGig,
  transitionGigAttempt,
} from "./gigs-attempts.ts";

after(() => cleanupUnitDb());

const WS = "ws-gig-attempts";
const OTHER = "ws-gig-attempts-other";

let seq = 0;
function gig(ws = WS) {
  seq += 1;
  return upsertGigFromRaw(ws, {
    sourceId: "gsrc",
    arena: "oss_bounty",
    raw: {
      externalKey: `k-${seq}`,
      url: `https://example.test/${seq}`,
      title: `Gig ${seq}`,
      org: null,
      reward: null,
      deadlineAt: null,
      postedAt: null,
      bodyText: "Do the thing.",
      bodyHtml: null,
      tags: [],
    },
    suspectReasons: [],
  }).gig;
}

const DELIVERABLE: GigDeliverable = {
  version: 1,
  summary: "Fixed the parser.",
  draftText: "This PR fixes trailing commas.",
  artifacts: [{ kind: "pr", ref: "https://github.com/acme/repo/pull/7", title: "Fix" }],
  evidence: [{ kind: "test", command: "cargo test", result: "42 passed", passed: true }],
  disclosure: "Drafted with an AI agent; reviewed by me.",
  confidence: 0.7,
  questions: [],
};

const REVIEW: GigReview = { checklist: { disclosure: true }, note: null, reviewMs: 90000, reviewedAt: "2026-09-24T10:00:00.000Z" };

test("an attempt walks dispatched -> running -> drafted -> approved -> sent, patching in the same statement", () => {
  const g = gig();
  const a = createGigAttempt(WS, { gigId: g.id, specialistId: "gspec-1", revisionNote: null });
  assert.ok(a);
  assert.equal(a.status, "dispatched");
  assert.equal(a.costUsd, null);

  const running = transitionGigAttempt(WS, a.id, { from: "dispatched", to: "running", patch: { executionId: "exec-1" } });
  assert.equal(running.ok && running.attempt.executionId, "exec-1");
  const drafted = transitionGigAttempt(WS, a.id, { from: ["dispatched", "running"], to: "drafted", patch: { deliverable: DELIVERABLE, costUsd: 0.42 } });
  assert.equal(drafted.ok, true);
  assert.deepEqual(drafted.ok && drafted.attempt.deliverable, DELIVERABLE);
  assert.equal(drafted.ok && drafted.attempt.costUsd, 0.42);
  transitionGigAttempt(WS, a.id, { from: "drafted", to: "approved", patch: { review: REVIEW } });
  const sent = transitionGigAttempt(WS, a.id, { from: "approved", to: "sent", patch: { sentAt: "2026-09-24T11:00:00.000Z" } });
  assert.equal(sent.ok && sent.attempt.status, "sent");
  assert.equal(sent.ok && sent.attempt.sentAt, "2026-09-24T11:00:00.000Z");
  assert.deepEqual(sent.ok && sent.attempt.review, REVIEW);
});

test("illegal, stale and not_found are distinct refusals, and a refusal writes nothing", () => {
  const g = gig();
  const a = createGigAttempt(WS, { gigId: g.id, specialistId: "gspec-1", revisionNote: "tighter scope" })!;
  assert.equal(a.revisionNote, "tighter scope");
  assert.deepEqual(transitionGigAttempt(WS, a.id, { from: "dispatched", to: "sent" }), { ok: false, reason: "illegal" });
  assert.deepEqual(transitionGigAttempt(WS, a.id, { from: "running", to: "drafted", patch: { costUsd: 9 } }), { ok: false, reason: "stale" });
  assert.equal(getGigAttempt(WS, a.id)?.costUsd, null, "a stale move wrote no patch");
  assert.deepEqual(transitionGigAttempt(WS, "gatt-missing", { from: "dispatched", to: "failed" }), { ok: false, reason: "not_found" });
  // A non-finite cost is stored as "not reported".
  const failed = transitionGigAttempt(WS, a.id, { from: "dispatched", to: "failed", patch: { costUsd: Number.NaN, fallbackReason: "no_deliverable_block" } });
  assert.equal(failed.ok && failed.attempt.costUsd, null);
  assert.equal(failed.ok && failed.attempt.fallbackReason, "no_deliverable_block");
  // Terminal.
  assert.deepEqual(transitionGigAttempt(WS, a.id, { from: "failed", to: "drafted" }), { ok: false, reason: "illegal" });
});

test("lists: per gig oldest first, by status as a queue, empty filter matches nothing", () => {
  const ws = "ws-gig-attempts-list";
  const g = gig(ws);
  const a1 = createGigAttempt(ws, { gigId: g.id, specialistId: "s", revisionNote: null })!;
  const a2 = createGigAttempt(ws, { gigId: g.id, specialistId: "s", revisionNote: null })!;
  transitionGigAttempt(ws, a1.id, { from: "dispatched", to: "failed" });
  assert.deepEqual(listGigAttemptsForGig(ws, g.id).map((a) => a.id).sort(), [a1.id, a2.id].sort());
  assert.deepEqual(listGigAttemptsByStatus(ws, ["dispatched"]).map((a) => a.id), [a2.id]);
  assert.deepEqual(listGigAttemptsByStatus(ws, ["dispatched", "failed"]).length, 2);
  assert.deepEqual(listGigAttemptsByStatus(ws, []), []);
});

test("an attempt cannot be minted against another workspace's gig, nor read or moved from there", () => {
  const theirs = gig(OTHER);
  assert.equal(createGigAttempt(WS, { gigId: theirs.id, specialistId: "s", revisionNote: null }), null);
  const mine = createGigAttempt(WS, { gigId: gig().id, specialistId: "s", revisionNote: null })!;
  assert.equal(getGigAttempt(OTHER, mine.id), null);
  assert.deepEqual(listGigAttemptsForGig(OTHER, mine.gigId), []);
  assert.deepEqual(listGigAttemptsByStatus(OTHER, ["dispatched"]), []);
  assert.deepEqual(transitionGigAttempt(OTHER, mine.id, { from: "dispatched", to: "failed" }), { ok: false, reason: "not_found" });
  assert.equal(getGigAttempt(WS, mine.id)?.status, "dispatched");
});
