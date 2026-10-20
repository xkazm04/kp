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
import { actOnPipelineEntry, createPipelineEntry, getPipelineEntry, listPipelineEventsForEntry, listReconsiderQueue, setApproval } from "../../_lib/db/pipeline.ts";
import { setDecisionConfig } from "../../_lib/decision-config-store.ts";
import { PIPELINE_STAGES_DEFAULT } from "../../_lib/decision-config-schema.ts";
import { listDecisionRecords } from "../../_lib/decision-record-store.ts";
import { HUMAN_ROLE_ACTOR } from "../../_lib/auth/operator-approver.ts";
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

test("a reinstate names its actor in BOTH halves of the record (event row + seal), not just the seal", async () => {
  // UAT LUC-ANA-4 — reversing the machine is the act that most needs a name, and the
  // store already writes one (pipeline-event-actor.test.ts pins it). This route was the
  // last human write that never passed one: the `reinstated` event landed with actor
  // NULL — "not identified" in the decision log's Kdo column — while the seal beside it
  // claimed a human, so the two halves of one act disagreed. Here (no session) the
  // resolved actor is the honest role token; on an identified deployment humanActor()
  // resolves the person, and the point is that the SAME value reaches both halves.
  const entry = entryFixture({ stage: "Screened" });
  actOnPipelineEntry(entry.id, "reject", undefined, { actor: "system", actorRef: "auto:screen-wave" });

  const res = await post(entry.id, { action: "reinstate" });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).entry.status, "active");

  const trail = listPipelineEventsForEntry(entry.id);
  assert.equal(
    trail.find((e) => e.kind === "auto_rejected")?.actor,
    "auto:screen-wave",
    "the machine's rejection keeps naming the machine"
  );
  assert.equal(
    trail.find((e) => e.kind === "reinstated")?.actor,
    HUMAN_ROLE_ACTOR,
    "the reversal event must carry the acting human, not NULL"
  );
  const seal = listDecisionRecords({ candidateRef: entry.id }).find((r) => r.kind === "reinstated");
  assert.ok(seal, "the reversal is sealed into the chain");
  assert.equal(seal.actor, HUMAN_ROLE_ACTOR, "the seal and the event row name the SAME actor");
});

// ---- challenge-r07 pipeline-api/A: the door's declared action table ---------------

test("an unknown action is refused at the door with PIPELINE_ACTION_UNKNOWN", async () => {
  const entry = entryFixture({ stage: "Screened" });
  const res = await post(entry.id, { action: "bogus" });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, "PIPELINE_ACTION_UNKNOWN");
  assert.equal(getPipelineEntry(entry.id)!.status, "active");
});

test("an engine claim is honoured only on accept: a reject carrying actor:'sim' stays a HUMAN reject", async () => {
  const entry = entryFixture({ stage: "Screened" });
  const res = await post(entry.id, { action: "reject", actor: "sim" });
  assert.equal(res.status, 200);
  const kinds = listPipelineEventsForEntry(entry.id).map((e) => e.kind);
  assert.ok(kinds.includes("rejected"), "the event row names the human act");
  assert.ok(!kinds.includes("auto_rejected"), "a body-supplied actor must not file a human reject as a machine one");
  const seal = listDecisionRecords({ candidateRef: entry.id }).find((r) => r.kind === "rejected" || r.kind === "auto_rejected");
  assert.ok(seal, "the reject is sealed");
  assert.equal(seal.kind, "rejected");
  assert.match(seal.actor, /^human:/, "the sealed actor is the human seat, never auto:sim");
  assert.ok(
    !listReconsiderQueue(200).items.some((i) => i.entry.id === entry.id),
    "a recruiter's reject is a decision, never a Reconsider queue item",
  );

  // The guided sim's one legitimate claim is unchanged.
  const sim = entryFixture({ stage: "Accepted", jobTitle: "Route Test Role (SIM)" });
  assert.equal((await post(sim.id, { action: "accept", actor: "sim" })).status, 200);
  const simSeal = listDecisionRecords({ candidateRef: sim.id })[0];
  assert.equal(simSeal.actor, "auto:sim");
  assert.equal(simSeal.kind, "auto_advanced");
});

test("a reinstate seals the stage the candidate really landed on, on a renamed board", async () => {
  setDecisionConfig(
    "pipelineStages",
    {
      stages: [
        { id: "Accepted", label: "Accepted", role: "entry" },
        { id: "Vetted", label: "Vetted", role: "screening" },
        { id: "Interview", label: "Interview", role: "interview" },
        { id: "Offer", label: "Offer", role: "offer" },
        { id: "Hired", label: "Hired", role: "terminal" },
      ],
      retired: [{ id: "Screened", label: "Screened", role: "screening" }],
    },
    undefined,
    "team",
  );
  try {
    const entry = entryFixture({ stage: "Vetted" });
    actOnPipelineEntry(entry.id, "reject", undefined, { actor: "system", actorRef: "auto:screen-wave" });
    const res = await post(entry.id, { action: "reinstate" });
    assert.equal(res.status, 200);
    const landed = (await res.json()).entry.stage as string;
    assert.equal(landed, "Vetted", "the store lands the candidate on this board's screened column");
    const seal = listDecisionRecords({ candidateRef: entry.id }).find((r) => r.kind === "reinstated");
    assert.ok(seal);
    assert.equal((JSON.parse(seal.payloadJson) as { inputs: { restoredStage?: string } }).inputs.restoredStage, landed, "the record names the stage the candidate stands on");
  } finally {
    setDecisionConfig("pipelineStages", PIPELINE_STAGES_DEFAULT as unknown as Record<string, unknown>, undefined, "team");
  }
});

test("a reinstate refuses a hand reject: 'Auto-rejection reversed' is only ever written over an auto-rejection", async () => {
  const entry = entryFixture({ stage: "Screened" });
  assert.equal((await post(entry.id, { action: "reject" })).status, 200);
  const before = listPipelineEventsForEntry(entry.id).length;

  const res = await post(entry.id, { action: "reinstate" });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, "PIPELINE_NOT_REINSTATABLE");
  assert.equal(getPipelineEntry(entry.id)!.status, "rejected", "the recruiter's decision stands");
  assert.equal(listPipelineEventsForEntry(entry.id).length, before, "no reinstated event is written");
  assert.equal(
    listDecisionRecords({ candidateRef: entry.id }).filter((r) => r.kind === "reinstated").length,
    0,
    "no reversal is sealed",
  );
});
