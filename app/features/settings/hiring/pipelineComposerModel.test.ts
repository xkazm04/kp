import test from "node:test";
import assert from "node:assert/strict";
import {
  planHasRound,
  planRoutesAiScorecardToHumanRound,
  validateDecisionConfig,
  type InterviewPlanRule,
} from "@/app/_lib/decision-config-schema";
import { DEFAULT_STAGE_AXIS, PIPELINE_STAGES, type StageDef } from "@/app/_lib/pipeline-stages";
import {
  composerStations,
  deriveImpact,
  fromStoredPlan,
  matchesPreset,
  newRound,
  planEqualsStored,
  PRESETS,
  toStoredPlan,
  type PipelinePlan,
} from "./pipelineComposerModel";

// ---- The preview must preview the REAL board -------------------------------
// This is the contract the whole P0 pass exists to create: before it, the impact
// strip emitted its own station vocabulary ("screened", "ai_interview", …) under
// a heading that said "Overview", so Settings and the board described two
// different products. Every assertion below fails the moment they diverge again.

const stageIds = (impact: ReturnType<typeof deriveImpact>) => impact.overview.map((s) => s.stageId);

test("the preview's stations ARE the board's columns, in board order", () => {
  for (const preset of PRESETS) {
    assert.deepEqual(
      stageIds(deriveImpact(preset.plan())),
      [...PIPELINE_STAGES],
      `${preset.id} must preview the real axis`
    );
  }
});

test("a plan with no rounds still previews every board column (they exist regardless)", () => {
  const impact = deriveImpact({ screeningGate: "human", rounds: [], offerGate: "human" });
  assert.deepEqual(stageIds(impact), [...PIPELINE_STAGES]);
  assert.deepEqual(
    impact.overview.filter((s) => s.rounds.length > 0),
    [],
    "no rounds means no station carries one"
  );
});

test("rounds land on interview stages, and a surplus round stacks rather than inventing a column", () => {
  // The shipped default: two rounds, one Interview column. The old preview drew a
  // phantom second column for this; the honest answer is one column running two
  // rounds, which is exactly what the hybrid handoff does at runtime.
  const impact = deriveImpact(PRESETS.find((p) => p.id === "hybrid")!.plan());
  const interview = impact.overview.find((s) => s.role === "interview")!;
  assert.deepEqual(interview.rounds, ["ai", "human"]);
  assert.equal(stageIds(impact).length, PIPELINE_STAGES.length, "no phantom columns");
});

test("rounds bind to interview stages left-to-right when the axis has several", () => {
  const axis: StageDef[] = [
    { id: "In", label: "In", role: "entry" },
    { id: "Screen", label: "Screen", role: "screening" },
    { id: "R1", label: "R1", role: "interview" },
    { id: "R2", label: "R2", role: "interview" },
    { id: "Out", label: "Out", role: "terminal" },
  ];
  const impact = deriveImpact({ screeningGate: "human", rounds: [newRound("ai"), newRound("human")], offerGate: "human" }, axis);
  assert.deepEqual(impact.overview.find((s) => s.stageId === "R1")!.rounds, ["ai"]);
  assert.deepEqual(impact.overview.find((s) => s.stageId === "R2")!.rounds, ["human"]);
});

test("the composer's fixed rows point at real board stages", () => {
  const stations = composerStations();
  assert.equal(stations.screening, "Screened");
  assert.equal(stations.offer, "Offer");
  assert.deepEqual(stations.interview, ["Interview"]);
  for (const id of [stations.screening, stations.offer, ...stations.interview]) {
    assert.ok(
      DEFAULT_STAGE_AXIS.some((s) => s.id === id),
      `${id} must be a real board column`
    );
  }
});

test("lean preset: auto screening, one gated AI round, human offer", () => {
  const plan = PRESETS.find((p) => p.id === "lean")!.plan();
  const impact = deriveImpact(plan);
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

test("zero rounds lights up no Schedule surface", () => {
  const impact = deriveImpact({ screeningGate: "human", rounds: [], offerGate: "human" });
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

const rule = (rounds: InterviewPlanRule["rounds"]): InterviewPlanRule => ({ screeningGate: "human", rounds, offerGate: "human" });

test("planHasRound reports which Schedule surfaces the plan lights up", () => {
  assert.equal(planHasRound(rule([{ kind: "ai", gate: "human", topN: null }]), "ai"), true);
  assert.equal(planHasRound(rule([{ kind: "ai", gate: "human", topN: null }]), "human"), false);
  assert.equal(planHasRound(rule([]), "ai"), false);
});

test("the hybrid handoff fires only when a HUMAN round follows the AI round", () => {
  const hybrid = rule([
    { kind: "ai", gate: "human", topN: null },
    { kind: "human", gate: "human", topN: 3 },
  ]);
  assert.equal(planRoutesAiScorecardToHumanRound(hybrid), true);
  // AI-only plan: the scorecard accept advances toward Offer as today.
  assert.equal(planRoutesAiScorecardToHumanRound(rule([{ kind: "ai", gate: "human", topN: null }])), false);
  // Human-only plan: there is no AI scorecard to route.
  assert.equal(planRoutesAiScorecardToHumanRound(rule([{ kind: "human", gate: "human", topN: null }])), false);
  // A human round BEFORE the ai round does not count as a follow-up.
  assert.equal(
    planRoutesAiScorecardToHumanRound(
      rule([
        { kind: "human", gate: "human", topN: null },
        { kind: "ai", gate: "human", topN: 3 },
      ])
    ),
    false
  );
});

test("matchesPreset compares structure, not round ids", () => {
  const hybrid = PRESETS.find((p) => p.id === "hybrid")!;
  const plan = hybrid.plan(); // fresh ids each call
  assert.equal(matchesPreset(plan, hybrid), true);
  plan.rounds[1].topN = 4;
  assert.equal(matchesPreset(plan, hybrid), false);
});
