// Pure logic for the line and the wires (line.ts, scan.ts): which queue a gig sits in, how
// far along the line it got, search, quick decline, the rejected streak, a source's scan.
// Runner: node --test (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { GigStatus } from "@/app/_lib/gigs/types.ts";
import { att, gig } from "./fixtures.ts";
import { canQuickDecline, matchesSearch, queueKindOf, reachedStep, streakTone } from "./line.ts";
import { sourceScanView } from "./scan.ts";

test("queueKindOf: each gig lands in exactly the queue of whoever acts next", () => {
  assert.equal(queueKindOf(gig("a", "suspect"), null), "suspect");
  assert.equal(queueKindOf(gig("a", "sent"), att("x", "a", "sent")), "record");
  assert.equal(queueKindOf(gig("a", "drafted"), att("x", "a", "drafted")), "review");
  assert.equal(queueKindOf(gig("a", "in_review"), att("x", "a", "approved")), "review");
  assert.equal(queueKindOf(gig("a", "dispatched"), att("x", "a", "running")), "running");
  assert.equal(queueKindOf(gig("a", "drafted"), att("x", "a", "revision_requested")), "revision");
  assert.equal(queueKindOf(gig("a", "new"), null), "triage");
  assert.equal(queueKindOf(gig("a", "qualified"), null), "triage");
  assert.equal(queueKindOf(gig("a", "qualified"), att("x", "a", "discarded")), "triage");
  assert.equal(queueKindOf(gig("a", "qualified"), att("x", "a", "failed")), "failed");
  for (const s of ["accepted", "rejected", "declined", "expired", "withdrawn"] as const) {
    assert.equal(queueKindOf(gig("a", s), null), null, `${s} needs nobody`);
  }
});

test("reachedStep separates 'none here now' from 'none reached'", () => {
  const accepted = [gig("x", "accepted")];
  assert.equal(reachedStep(accepted, {}, "drafted"), true, "an accepted gig passed through drafted");
  assert.equal(reachedStep(accepted, {}, "sent"), true);
  assert.equal(reachedStep(accepted, {}, "rejected"), false, "accepted and rejected are alternatives");
  assert.equal(reachedStep(accepted, {}, "suspect"), false, "suspect is a side branch, not a rank");
  const fresh = [gig("n", "new")];
  assert.equal(reachedStep(fresh, {}, "new"), true);
  assert.equal(reachedStep(fresh, {}, "qualified"), false);
  // A declined gig is read off its latest attempt.
  const left = [gig("d", "declined")];
  assert.equal(reachedStep(left, {}, "qualified"), false);
  assert.equal(reachedStep(left, { d: att("a", "d", "sent") }, "sent"), true);
  assert.equal(reachedStep(left, { d: att("a", "d", "failed") }, "dispatched"), true);
  assert.equal(reachedStep(left, { d: att("a", "d", "failed") }, "drafted"), false);
  assert.equal(reachedStep([gig("c", "new", { suspectReasons: ["agent_addressed"] })], {}, "suspect"), true);
});

test("matchesSearch reads title, org, id, niche and tags", () => {
  const g = gig("gig_7", "new", { title: "Rust CLI bounty", org: "Acme", tags: ["tokio"], niche: "cli" });
  for (const q of ["rust", "ACME", "gig_7", "tokio", "cli", "  "]) assert.equal(matchesSearch(g, q), true, q);
  assert.equal(matchesSearch(g, "python"), false);
});

// ---------------------------------------------------------------------------
// Quick decisions on a gig's page
// ---------------------------------------------------------------------------

test("canQuickDecline offers D exactly where PATCH decline is allowed", () => {
  const offered = (["new", "suspect", "qualified", "dispatched", "drafted", "in_review", "sent", "accepted", "rejected", "declined", "expired", "withdrawn"] as GigStatus[]).filter(canQuickDecline);
  assert.deepEqual(offered, ["new", "suspect", "qualified", "drafted", "in_review"]);
});

test("streakTone: 0 of 5 is calm (never absent), rising to the limit", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((n) => streakTone(n, 5)), ["calm", "calm", "watch", "watch", "near", "at", "at"]);
});

test("sourceScanView reads the source's own run line; a pause before the run is 'not run'; junk is unknown, never 0 new", () => {
  const result = { sourceId: "s1", notRunnable: 0, aborted: false, sources: [{ sourceId: "s1", outcome: "succeeded", reason: null, created: 3, found: 9, adapter: "github_bounty", paused: null, suspect: 0 }] };
  assert.deepEqual(sourceScanView(result, "s1"), { kind: "ran", outcome: "succeeded", reason: null, created: 3, found: 9 });
  assert.deepEqual(sourceScanView({ ...result, sources: [], notRunnable: 1 }, "s1"), { kind: "not_run" });
  assert.deepEqual(sourceScanView({ ...result, sources: [] }, "s1"), { kind: "unknown" });
  assert.deepEqual(sourceScanView(null, "s1"), { kind: "unknown" });
  assert.deepEqual(sourceScanView({ nope: 1 }, "s1"), { kind: "unknown" });
});
