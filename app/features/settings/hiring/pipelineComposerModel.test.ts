import test from "node:test";
import assert from "node:assert/strict";
import { validateDecisionConfig } from "@/app/_lib/decision-config-schema";
import {
  deriveImpact,
  fromStoredPlan,
  matchesPreset,
  newRound,
  planEqualsStored,
  PRESETS,
  toStoredPlan,
  type PipelinePlan,
} from "./pipelineComposerModel";

test("lean preset: auto screening, one gated AI round, human offer", () => {
  const plan = PRESETS.find((p) => p.id === "lean")!.plan();
  const impact = deriveImpact(plan);
  assert.deepEqual(impact.overview, ["screened", "ai_interview", "offer", "hired"]);
  assert.deepEqual(impact.decisions, ["ai_scorecard_review", "offer_review"]);
  assert.deepEqual(impact.schedule, { aiRound: true, humanRound: false });
  assert.equal(impact.humanTouchpoints, 2);
});

test("enterprise preset: every gate human, both schedule surfaces", () => {
  const plan = PRESETS.find((p) => p.id === "enterprise")!.plan();
  const impact = deriveImpact(plan);
  assert.deepEqual(impact.decisions, [
    "screening_review",
    "ai_scorecard_review",
    "human_scorecard_review",
    "human_scorecard_review",
    "offer_review",
  ]);
  assert.deepEqual(impact.schedule, { aiRound: true, humanRound: true });
});

test("an ungated AI round produces no Decisions queue; a human round always does", () => {
  const plan: PipelinePlan = { screeningGate: "auto", rounds: [newRound("ai", "auto")], offerGate: "auto" };
  const impact = deriveImpact(plan);
  assert.deepEqual(impact.decisions, []);
  assert.equal(impact.humanTouchpoints, 0);
  plan.rounds.push(newRound("human", "auto"));
  assert.deepEqual(deriveImpact(plan).decisions, ["human_scorecard_review"]);
});

test("zero rounds still yields a coherent funnel (screen → offer → hired)", () => {
  const impact = deriveImpact({ screeningGate: "human", rounds: [], offerGate: "human" });
  assert.deepEqual(impact.overview, ["screened", "offer", "hired"]);
  assert.deepEqual(impact.schedule, { aiRound: false, humanRound: false });
});

test("stored ↔ UI roundtrip: ids are minted on load, dropped on save, equality is structural", () => {
  const plan = PRESETS.find((p) => p.id === "hybrid")!.plan();
  const stored = toStoredPlan(plan);
  assert.equal(JSON.stringify(stored).includes('"id"'), false, "wire shape carries no round ids");
  const back = fromStoredPlan(stored);
  assert.equal(planEqualsStored(back, stored), true);
  back.rounds[0].gate = "auto";
  assert.equal(planEqualsStored(back, stored), false, "a gate flip makes the draft dirty");
});

test("every preset's wire shape passes the decision-config interviewPlan validator", () => {
  for (const p of PRESETS) {
    const result = validateDecisionConfig("interviewPlan", toStoredPlan(p.plan()));
    assert.equal(result.ok, true, `${p.id} must validate`);
  }
});

test("the interviewPlan validator normalizes: human rounds are always human-gated, round 1 has no reducer, topN clamps", () => {
  const result = validateDecisionConfig("interviewPlan", {
    screeningGate: "auto",
    rounds: [
      { kind: "ai", gate: "auto", topN: 4 },
      { kind: "human", gate: "auto", topN: 9999 },
    ],
    offerGate: "human",
  });
  assert.equal(result.ok, true);
  if (result.ok && result.phase === "interviewPlan") {
    assert.equal(result.config.rounds[0].topN, null, "round 1 carries no reducer");
    assert.equal(result.config.rounds[1].gate, "human", "a human round can never be unattended");
    assert.equal(result.config.rounds[1].topN, 50, "topN clamps to the cap");
  }
});

test("the interviewPlan validator rejects stray keys and bad shapes", () => {
  assert.equal(validateDecisionConfig("interviewPlan", { screeningGate: "human", rounds: [], offerGate: "human", extra: 1 }).ok, false);
  assert.equal(validateDecisionConfig("interviewPlan", { screeningGate: "maybe", rounds: [], offerGate: "human" }).ok, false);
  assert.equal(
    validateDecisionConfig("interviewPlan", {
      screeningGate: "human",
      rounds: [{ kind: "ai", gate: "human", topN: null }, { kind: "ai", gate: "human", topN: null }, { kind: "ai", gate: "human", topN: null }, { kind: "ai", gate: "human", topN: null }],
      offerGate: "human",
    }).ok,
    false,
    "rounds cap enforced"
  );
});

test("matchesPreset compares structure, not round ids", () => {
  const hybrid = PRESETS.find((p) => p.id === "hybrid")!;
  const plan = hybrid.plan(); // fresh ids each call
  assert.equal(matchesPreset(plan, hybrid), true);
  plan.rounds[1].topN = 4;
  assert.equal(matchesPreset(plan, hybrid), false);
});
