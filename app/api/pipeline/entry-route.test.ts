// Handler-level coverage for /api/pipeline/[id] against an ISOLATED throwaway DB
// (testing/unit-db.ts must stay the first project import). Pins the two seams the
// guided-simulation L2 run exposed (uat/runs/2026-07-02-full):
//
//   - gsim-l2-102 — Hired is OUTCOME-bearing: a bare accept on an Offer-stage
//     entry must be refused (422), never fall through to a phantom hire with no
//     offer record. The only path to Hired is offer_review accept → the offer is
//     EXTENDED → the candidate accepts through their token (offer-finalize).
//   - gsim-l2-103 — audit attribution is truthful: a programmatic caller that
//     declares actor:"sim" is recorded as the engine (auto_advanced event +
//     "auto:sim" seal), a plain accept stays human ("human:recruiter"), and the
//     declaration can only downgrade authority — never forge a human decision.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { POST } from "./[id]/route.ts";
import { createPipelineEntry, getPipelineEntry, listPipelineEventsForEntry, setApproval } from "../../_lib/db/pipeline.ts";
import { listDecisionRecords } from "../../_lib/decision-record-store.ts";
import { respondToOffer } from "../../_lib/offer-finalize.ts";

after(() => cleanupUnitDb());

const post = (id: string, body: unknown): Promise<Response> =>
  POST(
    new NextRequest(`http://localhost/api/pipeline/${id}`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ id }) }
  );

let seq = 0;
function entryFixture(overrides: Partial<Parameters<typeof createPipelineEntry>[0]> = {}) {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `pr-c${seq}`,
    candidateLabel: `Route Candidate ${seq}`,
    jobId: `pr-job-${seq}`,
    jobTitle: "Route Test Role",
    ...overrides,
  });
  return entry;
}

const advanceKinds = (id: string) =>
  listPipelineEventsForEntry(id)
    .filter((e) => e.kind === "advanced" || e.kind === "auto_advanced")
    .map((e) => e.kind);

test("a bare accept at Offer is refused (422): no phantom Hired without an extended offer", async () => {
  const entry = entryFixture({ stage: "Offer" });
  const res = await post(entry.id, { action: "accept" });
  assert.equal(res.status, 422);
  assert.match((await res.json()).error, /accepts an offer/);
  assert.equal(getPipelineEntry(entry.id)!.stage, "Offer", "the entry must not move");
  assert.deepEqual(advanceKinds(entry.id), [], "no advance event may be written for a refused hire");
  // The sim actor cannot bypass the gate either — the rule is about the OUTCOME,
  // not the caller.
  const viaSim = await post(entry.id, { action: "accept", actor: "sim" });
  assert.equal(viaSim.status, 422);
});

test("the legitimate path still hires: offer_review accept EXTENDS (not Hired); the candidate's token accept hires", async () => {
  const entry = entryFixture({ stage: "Offer" });
  setApproval(entry.id, "offer_review", JSON.stringify({ subject: "Offer", body: "Hi", recommended: 140000, currency: "CZK" }));

  const res = await post(entry.id, { action: "accept" });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.offerExtended, true, "approving the drafted offer extends it");
  assert.equal(getPipelineEntry(entry.id)!.stage, "Offer", "extending an offer is not hiring");
  assert.equal(getPipelineEntry(entry.id)!.approvalKind, null, "the approval is consumed — now awaiting the candidate");

  // Only the CANDIDATE's response moves the entry to Hired.
  const token = String(body.link).split("/offer/")[1];
  const outcome = await respondToOffer(token, "accept");
  assert.ok(outcome.ok && outcome.status === "accepted");
  assert.equal(getPipelineEntry(entry.id)!.stage, "Hired", "Hired is reached exactly once, via the offer acceptance");
});

test("actor:'sim' is recorded as the engine (auto_advanced + auto:sim seal); a plain accept stays human", async () => {
  const sim = entryFixture({ stage: "Accepted", jobTitle: "Route Test Role (SIM)" });
  const res = await post(sim.id, { action: "accept", actor: "sim" });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).entry.stage, "Screened");
  assert.deepEqual(advanceKinds(sim.id), ["auto_advanced"], "an engine accept must not write a human 'advanced' event");
  const simSeal = listDecisionRecords({ candidateRef: sim.id })[0];
  assert.ok(simSeal, "the decision is still sealed into the chain");
  assert.equal(simSeal.actor, "auto:sim", "the sealed record names the engine, not 'human:recruiter'");
  assert.equal(simSeal.kind, "auto_advanced");
  assert.match(simSeal.rationale, /Guided simulation accept/, "the default rationale must not claim a recruiter acted");

  const human = entryFixture({ stage: "Accepted" });
  const humanRes = await post(human.id, { action: "accept" });
  assert.equal(humanRes.status, 200);
  assert.deepEqual(advanceKinds(human.id), ["advanced"]);
  const humanSeal = listDecisionRecords({ candidateRef: human.id })[0];
  assert.equal(humanSeal.actor, "human:recruiter");
  assert.equal(humanSeal.kind, "advanced");

  // An unrecognized actor value never grants automation attribution — it stays a
  // human decision (the claim can only downgrade, so nothing can spoof AUTO
  // upward into a forged human record, and garbage can't relabel a human as a bot).
  const odd = entryFixture({ stage: "Accepted" });
  await post(odd.id, { action: "accept", actor: "robot-overlord" });
  assert.deepEqual(advanceKinds(odd.id), ["advanced"]);
  assert.equal(listDecisionRecords({ candidateRef: odd.id })[0].actor, "human:recruiter");
});
