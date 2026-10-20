// Pins the ONE decide-outcome fold every Decisions door goes through: a response
// becomes either a typed forward handoff or a coded failure — never server English
// — and the single-row door and the batch bar share one handoff rule.
//
// Non-vacuity: before this module existed act() threw the refusal body away
// (`if (!r.ok) throw new Error()`) and the batch path joined the server's English
// `reason`; the handoff rule was written twice and the batch copy dropped the AI
// scorecard's routedToHumanRound.
//
// Runner: Node's built-in test runner (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { foldBatchDecide, foldDecideResponse } from "./decisionsDecideOutcome.ts";

const screening = (id: string) => ({ id, approvalKind: "screening_review" as const, candidateLabel: `Label ${id}` });
const scorecard = (id: string) => ({ id, approvalKind: "scorecard_review" as const, candidateLabel: `Label ${id}` });
const offer = (id: string) => ({ id, approvalKind: "offer_review" as const, candidateLabel: `Label ${id}` });

test("an accepted screening queues for Schedule and backfills the interview-prep task", () => {
  const out = foldDecideResponse(screening("a"), "accept", { ok: true, status: 200 }, { entry: {} });
  assert.deepEqual(out, { ok: true, handoff: { queueForSchedule: true, prepTask: true, offerLink: null } });
});

test("an accepted AI scorecard queues for Schedule ONLY when the server routed it to the human round", () => {
  const routed = foldDecideResponse(scorecard("b"), "accept", { ok: true, status: 200 }, { routedToHumanRound: true });
  assert.deepEqual(routed, { ok: true, handoff: { queueForSchedule: true, prepTask: false, offerLink: null } });
  const plain = foldDecideResponse(scorecard("b"), "accept", { ok: true, status: 200 }, { entry: {} });
  assert.equal(plain.ok && plain.handoff.queueForSchedule, false);
});

test("an extended offer carries its secure link — and never a non-string one", () => {
  const out = foldDecideResponse(offer("c"), "accept", { ok: true, status: 200 }, { offerExtended: true, link: "https://h/offer/t" });
  assert.equal(out.ok && out.handoff.offerLink, "https://h/offer/t");
  const bad = foldDecideResponse(offer("c"), "accept", { ok: true, status: 200 }, { offerExtended: true, link: 42 });
  assert.equal(bad.ok && bad.handoff.offerLink, null);
});

test("a refused decision is a CODE with its status, never the server's prose; a thrown fetch is a code-less failure", () => {
  const out = foldDecideResponse(screening("a"), "reject", { ok: false, status: 409 }, { code: "PIPELINE_STAGE_CHANGED", error: "English prose" });
  assert.deepEqual(out, { ok: false, failure: { code: "PIPELINE_STAGE_CHANGED", capability: null, status: 409 } });
  assert.ok(!JSON.stringify(out).includes("English"), "no server English rides the outcome");
  assert.ok(!("error" in out) && !("reason" in out));
  const thrown = foldDecideResponse(screening("a"), "reject", null, null);
  assert.deepEqual(thrown, { ok: false, failure: { code: null, capability: null, status: null } });
});

test("a batch accept folds per-id outcomes into ids, codes and the SAME handoff rule as the single door", () => {
  const targets = [screening("a"), scorecard("b"), screening("c")];
  const out = foldBatchDecide(targets, "accept", {
    ok: true,
    results: [
      { id: "a", ok: true },
      { id: "b", ok: true, routedToHumanRound: true },
      { id: "c", ok: false, code: "PIPELINE_STAGE_CHANGED", reason: "English" },
    ],
  });
  assert.deepEqual(out.okIds, ["a", "b"]);
  assert.deepEqual(out.failedIds, ["c"]);
  assert.deepEqual(out.codes, ["PIPELINE_STAGE_CHANGED"]);
  assert.deepEqual(out.queuedLabels, ["Label a", "Label b"]);
  assert.deepEqual(out.prepIds, ["a"]);
  assert.equal(out.requestFailure, null);
  assert.ok(!JSON.stringify(out).includes("English"), "the per-id English reason is dropped");
});

test("a whole-request refusal fails every target and overrides per-id codes", () => {
  const targets = [screening("a"), scorecard("b")];
  const out = foldBatchDecide(targets, "reject", { ok: false, status: 403, code: "FORBIDDEN_CAPABILITY", capability: "pipeline:write" });
  assert.deepEqual(out.failedIds, ["a", "b"]);
  assert.deepEqual(out.okIds, []);
  assert.deepEqual(out.requestFailure, { code: "FORBIDDEN_CAPABILITY", capability: "pipeline:write" });
  assert.deepEqual(out.codes, []);
  assert.deepEqual(out.queuedLabels, []);
  // A transport blip is still a request failure, just code-less.
  const blip = foldBatchDecide(targets, "accept", { ok: false });
  assert.deepEqual(blip.requestFailure, { code: null, capability: null });
});

test("a target the server never reported is a failure, not a silent success", () => {
  const out = foldBatchDecide([screening("a"), screening("b")], "accept", { ok: true, results: [{ id: "a", ok: true }] });
  assert.deepEqual(out.okIds, ["a"]);
  assert.deepEqual(out.failedIds, ["b"]);
});
