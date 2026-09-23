// The candidate bundle's state machine (candidateBundle.ts): the one-call story learns
// it is stale. Every case is a way the old single-shot fetch lied — a non-object body
// read through unchecked casts, a re-pull failure that blanked a good history and
// flipped the GDPR panel to "could not load", an older response overwriting a newer
// one, and in-modal writes whose rows stayed invisible until close-and-reopen.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bundleReducer,
  consentFailed,
  initialBundleState,
  invalidatesBundle,
  parseCandidateBundle,
  type BundleState,
  type CandidateBundleData,
} from "./candidateBundle.ts";

const D: CandidateBundleData = parseCandidateBundle({ events: [], notes: "wants 80k" }) as CandidateBundleData;

// --- the parser -------------------------------------------------------------------

test("a non-object body is a failed load, never a thrown cast", () => {
  assert.equal(parseCandidateBundle(null), null);
  assert.equal(parseCandidateBundle("x"), null);
  assert.equal(parseCandidateBundle([]), null);
});

test("absent sections default, and the sealed decisions ride along instead of being dropped", () => {
  const d = parseCandidateBundle({ events: [] });
  assert.ok(d);
  assert.deepEqual(d.events, []);
  assert.deepEqual(d.comms, []);
  assert.equal(d.consent, null);
  assert.deepEqual(d.decisions, []);
  assert.deepEqual(d.items, []);
  assert.deepEqual(d.rematchLinks, {});
  assert.equal(d.notes, null);
  assert.equal(d.staleSince, null);

  const decision = { seq: 3, kind: "auto_advanced", actor: "auto:x", reasonCode: "r", policyVersion: "p", rationale: "", createdAt: "2026-09-01", keyed: true };
  assert.deepEqual(parseCandidateBundle({ decisions: [decision] })?.decisions, [decision]);
  // A wrong-typed section is a default, not a crash one render later.
  const odd = parseCandidateBundle({ events: "nope", comms: {}, consent: [], notes: 7, rematchLinks: [] });
  assert.ok(odd);
  assert.deepEqual(odd.events, []);
  assert.deepEqual(odd.comms, []);
  assert.equal(odd.consent, null);
  assert.equal(odd.notes, null);
  assert.deepEqual(odd.rematchLinks, {});
});

test("every human scorecard rides the parse; an empty artifact and a wrong-typed list are dropped", () => {
  const card = { summary: "round one", ratings: [], authorLabel: "Alena", stage: "interview", savedAt: "2026-09-23", legacy: false };
  const d = parseCandidateBundle({ humanScorecards: [card, { ratings: [], summary: "" }, "junk", { ...card, summary: "round two" }] });
  assert.deepEqual(d?.humanScorecards.map((c) => c.summary), ["round one", "round two"]);
  assert.deepEqual(parseCandidateBundle({ humanScorecards: {} })?.humanScorecards, []);
  assert.deepEqual(parseCandidateBundle({})?.humanScorecards, []);
});

// --- the reducer ------------------------------------------------------------------

test("a first-load failure is 'failed', and retry goes back to loading on a new seq", () => {
  const start: BundleState = { status: "loading", data: null, seq: 1 };
  const failed = bundleReducer(start, { type: "fail", seq: 1 });
  assert.deepEqual(failed, { status: "failed", data: null, seq: 1 });
  assert.equal(consentFailed(failed), true);
  const again = bundleReducer(failed, { type: "retry" });
  assert.equal(again.status, "loading");
  assert.equal(again.data, null);
  assert.ok(again.seq > failed.seq);
});

test("invalidate keeps the last-good story painted while it re-pulls", () => {
  const ready: BundleState = { status: "ready", data: D, seq: 1 };
  const next = bundleReducer(ready, { type: "invalidate" });
  assert.equal(next.status, "refreshing");
  assert.equal(next.data, D);
  assert.equal(next.seq, 2);
});

test("a failed RE-pull goes stale, keeping the good GDPR snapshot on screen", () => {
  const refreshing: BundleState = { status: "refreshing", data: D, seq: 2 };
  const next = bundleReducer(refreshing, { type: "fail", seq: 2 });
  assert.deepEqual(next, { status: "stale", data: D, seq: 2 });
  assert.equal(consentFailed(next), false);
});

test("an older response can never overwrite a newer one", () => {
  const refreshing: BundleState = { status: "refreshing", data: D, seq: 2 };
  const older = parseCandidateBundle({ notes: "old" }) as CandidateBundleData;
  assert.equal(bundleReducer(refreshing, { type: "settle", seq: 1, data: older }), refreshing);
  assert.equal(bundleReducer(refreshing, { type: "fail", seq: 1 }), refreshing);
  const newer = parseCandidateBundle({ notes: "new" }) as CandidateBundleData;
  assert.deepEqual(bundleReducer(refreshing, { type: "settle", seq: 2, data: newer }), { status: "ready", data: newer, seq: 2 });
});

test("switching candidates drops the previous story and starts a fresh load", () => {
  const ready: BundleState = { status: "ready", data: D, seq: 4 };
  const next = bundleReducer(ready, { type: "reset" });
  assert.equal(next.status, "loading");
  assert.equal(next.data, null);
  assert.ok(next.seq > 4);
  assert.deepEqual(initialBundleState(), { status: "loading", data: null, seq: 1 });
});

// --- the invalidation map ---------------------------------------------------------

test("a task that wrote a row the story reads re-pulls it; a stage move or a no-op does not", () => {
  for (const applied of ["scorecard_ready", "offer_ready", "held_for_review", "rematched"]) {
    assert.equal(invalidatesBundle({ kind: "task", applied }), true, applied);
  }
  // `drafted` records rejection_drafted / interview_prep_generated (automation-run.ts),
  // an event the history shows — so it re-pulls (the card listed it as a no-op).
  assert.equal(invalidatesBundle({ kind: "task", applied: "drafted" }), true);
  for (const applied of ["advisory", "no_alternative", "already_rematched", "already_sent", "advanced", "auto_ratified"]) {
    assert.equal(invalidatesBundle({ kind: "task", applied }), false, applied);
  }
  // An outcome nobody declared fails toward fresh, never toward a silent stale modal.
  assert.equal(invalidatesBundle({ kind: "task", applied: "some_future_outcome" }), true);
});

test("a minted link re-pulls (its invite letter + timeline row); a refused mint does not", () => {
  for (const flow of ["schedule", "voice"] as const) {
    assert.equal(invalidatesBundle({ kind: "link", flow, minted: true }), true);
    assert.equal(invalidatesBundle({ kind: "link", flow, minted: false }), false);
  }
});

test("a resend re-pulls (the route stamps the history and writes a new letter)", () => {
  assert.equal(invalidatesBundle({ kind: "resend" }), true);
});
