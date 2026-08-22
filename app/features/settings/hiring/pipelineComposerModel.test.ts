import test from "node:test";
import assert from "node:assert/strict";
import {
  migrateLegacyInterviewPlan,
  planHasRound,
  planRounds,
  planRoutesAiScorecardToHumanRound,
  planStep,
  prunePlanToAxis,
  validateDecisionConfig,
  type InterviewPlanRound,
  type InterviewPlanRule,
} from "@/app/_lib/decision-config-schema";
import { DEFAULT_STAGE_AXIS, PIPELINE_STAGES, type StageDef } from "@/app/_lib/pipeline-stages";
import {
  composerStations,
  deriveImpact,
  matchesPreset,
  newRound,
  planEqualsStored,
  PRESETS,
  roundCount,
  setStepGate,
  setStepRounds,
  sortPlanToAxis,
  patchRound,
  type PipelinePlan,
} from "./pipelineComposerModel";

/** A plan authored in the pre-migration vocabulary and converted — the readable
 *  way to write a fixture, and it exercises the migration on every one. */
const plan = (
  legacy: { screeningGate?: "auto" | "human"; rounds?: InterviewPlanRound[]; offerGate?: "auto" | "human" },
  axis: readonly StageDef[] = DEFAULT_STAGE_AXIS
): PipelinePlan =>
  migrateLegacyInterviewPlan(
    { screeningGate: legacy.screeningGate ?? "human", rounds: legacy.rounds ?? [], offerGate: legacy.offerGate ?? "human" },
    axis
  );

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
  const impact = deriveImpact(plan({}));
  assert.deepEqual(stageIds(impact), [...PIPELINE_STAGES]);
  assert.deepEqual(
    impact.overview.filter((s) => s.rounds.length > 0),
    [],
    "no rounds means no station carries one"
  );
});

test("a preset CLIPS to the board's interview columns instead of stacking", () => {
  // The shipped board has one interview column, so the hybrid preset's second
  // round has nowhere of its own to run and is dropped. One step runs one
  // activity: a second conversation is a second column, which the operator adds.
  const impact = deriveImpact(PRESETS.find((p) => p.id === "hybrid")!.plan());
  const interview = impact.overview.find((s) => s.role === "interview")!;
  assert.deepEqual(interview.rounds, ["ai"], "no second round doubled up behind one column");
  assert.equal(stageIds(impact).length, PIPELINE_STAGES.length, "no phantom columns");
});

test("the same preset fills a board that HAS the columns for it", () => {
  const axis: StageDef[] = [
    { id: "In", label: "In", role: "entry" },
    { id: "Screen", label: "Screen", role: "screening" },
    { id: "AI", label: "AI round", role: "interview" },
    { id: "Score", label: "Scoring", role: "scoring" },
    { id: "Panel", label: "Panel", role: "interview" },
    { id: "Offer", label: "Offer", role: "offer" },
    { id: "Out", label: "Out", role: "terminal" },
  ];
  // The shape the merged editor exists to make expressible: AI interview, then
  // automated scoring, then a human panel — each its own step.
  const impact = deriveImpact(PRESETS.find((p) => p.id === "hybrid")!.plan(axis), axis);
  assert.deepEqual(impact.overview.find((s) => s.stageId === "AI")!.rounds, ["ai"]);
  assert.deepEqual(impact.overview.find((s) => s.stageId === "Panel")!.rounds, ["human"]);
  assert.deepEqual(impact.overview.find((s) => s.stageId === "Score")!.rounds, [], "scoring runs no round");
});

test("a scoring column with a human guard raises its own review queue", () => {
  const axis: StageDef[] = [
    { id: "In", label: "In", role: "entry" },
    { id: "AI", label: "AI round", role: "interview" },
    { id: "Score", label: "Scoring", role: "scoring" },
    { id: "Out", label: "Out", role: "terminal" },
  ];
  const scored = setStepGate({ steps: [{ stageId: "AI", gate: "auto", rounds: [newRound("ai", "auto")] }] }, "Score", "human");
  assert.deepEqual(deriveImpact(scored, axis).decisions, ["ai_scorecard_review"], "somebody ratifies the number");
  const unattended = setStepGate(scored, "Score", "auto");
  assert.deepEqual(deriveImpact(unattended, axis).decisions, [], "or nobody does");
});

test("rounds bind to interview stages left-to-right when the axis has several", () => {
  const axis: StageDef[] = [
    { id: "In", label: "In", role: "entry" },
    { id: "Screen", label: "Screen", role: "screening" },
    { id: "R1", label: "R1", role: "interview" },
    { id: "R2", label: "R2", role: "interview" },
    { id: "Out", label: "Out", role: "terminal" },
  ];
  const impact = deriveImpact(plan({ rounds: [newRound("ai"), newRound("human")] }, axis), axis);
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

test("enterprise preset: every gate human, and its rounds clip to the board", () => {
  // Three rounds of intent, one interview column to run them at: the extras are
  // dropped rather than stacked, so the shipped board yields one AI round.
  const impact = deriveImpact(PRESETS.find((p) => p.id === "enterprise")!.plan());
  assert.deepEqual(impact.decisions, ["screening_review", "ai_scorecard_review", "offer_review"]);
  assert.deepEqual(impact.schedule, { aiRound: true, humanRound: false });

  // Give it the columns and the full intent lands, human rounds included.
  const wide: StageDef[] = [
    { id: "In", label: "In", role: "entry" },
    { id: "Screen", label: "Screen", role: "screening" },
    { id: "R1", label: "R1", role: "interview" },
    { id: "R2", label: "R2", role: "interview" },
    { id: "R3", label: "R3", role: "interview" },
    { id: "Offer", label: "Offer", role: "offer" },
    { id: "Out", label: "Out", role: "terminal" },
  ];
  const full = deriveImpact(PRESETS.find((p) => p.id === "enterprise")!.plan(wide), wide);
  assert.deepEqual(full.decisions, [
    "screening_review",
    "ai_scorecard_review",
    "human_scorecard_review",
    "human_scorecard_review",
    "offer_review",
  ]);
  assert.deepEqual(full.schedule, { aiRound: true, humanRound: true });
});

test("an ungated AI round produces no Decisions queue; a human round always does", () => {
  const ungated = plan({ screeningGate: "auto", rounds: [newRound("ai", "auto")], offerGate: "auto" });
  const impact = deriveImpact(ungated);
  assert.deepEqual(impact.decisions, []);
  assert.equal(impact.humanTouchpoints, 0);
  // A human round appended at the interview column it runs at.
  const withHuman = setStepRounds(ungated, "Interview", [newRound("ai", "auto"), newRound("human", "auto")]);
  assert.deepEqual(deriveImpact(withHuman).decisions, ["human_scorecard_review"]);
});

test("zero rounds lights up no Schedule surface", () => {
  const impact = deriveImpact(plan({}));
  assert.deepEqual(impact.schedule, { aiRound: false, humanRound: false });
});

test("the composed plan IS the wire shape — no projection to lose anything in", () => {
  const composed = PRESETS.find((p) => p.id === "hybrid")!.plan();
  // No UI-only fields to strip on the way out: what the editor holds is what the
  // validator accepts, which is why the projection layer could be deleted.
  assert.equal(JSON.stringify(composed).includes('"id"'), false, "no round ids to drop");
  const result = validateDecisionConfig("interviewPlan", composed);
  assert.equal(result.ok, true, "the editing shape validates as-is");
  if (result.ok && result.phase === "interviewPlan") assert.equal(planEqualsStored(composed, result.config), true);
  // And the dirty check still sees a real edit.
  assert.equal(planEqualsStored(setStepGate(composed, "Screened", "auto"), composed), false, "a gate flip makes the draft dirty");
});

test("every preset's wire shape passes the decision-config interviewPlan validator", () => {
  for (const p of PRESETS) {
    const result = validateDecisionConfig("interviewPlan", p.plan());
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
    // The legacy blob is accepted AND converted: the normalization rules are
    // unchanged, they are just read off the stage-keyed result now.
    const rounds = planRounds(result.config);
    assert.equal(rounds[0].topN, null, "round 1 carries no reducer");
    assert.equal(rounds[1].gate, "human", "a human round can never be unattended");
    assert.equal(rounds[1].topN, 50, "topN clamps to the cap");
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

// Every rounds-shaped fixture below is authored in the pre-migration vocabulary
// and converted, which keeps the fixtures readable AND exercises the migration
// on each one — the routing helpers must not care which column a round sits at.
const rule = (rounds: InterviewPlanRound[]): InterviewPlanRule =>
  migrateLegacyInterviewPlan({ screeningGate: "human", rounds, offerGate: "human" });

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

test("matchesPreset compares structure, and step order is not structure", () => {
  const hybrid = PRESETS.find((p) => p.id === "hybrid")!;
  const composed = hybrid.plan();
  assert.equal(matchesPreset(composed, hybrid), true);
  // Same policy, different step order — a plan is a set of per-column rules, and
  // the board decides the order, so this must still match.
  assert.equal(matchesPreset({ steps: [...composed.steps].reverse() }, hybrid), true);
  // A real change does not.
  assert.equal(matchesPreset(setStepGate(composed, "Screened", "auto"), hybrid), false);
});

// ---- editing ---------------------------------------------------------------

test("setStepGate creates a column's policy on first touch", () => {
  const empty: PipelinePlan = { steps: [] };
  // Absence means "nobody chose" — the first edit is what creates the step, and
  // it must not fabricate policy for any OTHER column while doing it.
  const one = setStepGate(empty, "Screened", "auto");
  assert.deepEqual(one.steps, [{ stageId: "Screened", gate: "auto", rounds: [] }]);
  assert.deepEqual(setStepGate(one, "Screened", "human").steps, [{ stageId: "Screened", gate: "human", rounds: [] }]);
});

test("flipping a round to human drops an auto gate the validator would rewrite", () => {
  const composed = plan({ rounds: [newRound("ai", "auto")] });
  const flipped = patchRound(composed, "Interview", 0, { kind: "human" });
  // The UI must never show a state that will not survive a save: a human round's
  // verdict IS the human decision.
  assert.equal(flipped.steps.find((s) => s.stageId === "Interview")!.rounds[0].gate, "human");
});

test("the round budget is plan-wide, not per column", () => {
  const axis: StageDef[] = [
    { id: "In", label: "In", role: "entry" },
    { id: "R1", label: "R1", role: "interview" },
    { id: "R2", label: "R2", role: "interview" },
    { id: "Out", label: "Out", role: "terminal" },
  ];
  const spread = plan({ rounds: [newRound("ai"), newRound("human")] }, axis);
  assert.equal(roundCount(spread, axis), 2, "one round at each of two columns still counts two");
});

test("a column the draft has REMOVED takes its rounds out of every card, Schedule included", () => {
  const full: StageDef[] = [
    { id: "Accepted", label: "Accepted", role: "entry" },
    { id: "Screened", label: "Screened", role: "screening" },
    { id: "Interview", label: "Interview", role: "interview" },
    { id: "Offer", label: "Offer", role: "offer" },
    { id: "Hired", label: "Hired", role: "terminal" },
  ];
  const composed = plan({ rounds: [newRound("ai")] }, full);
  assert.deepEqual(deriveImpact(composed, full).schedule, { aiRound: true, humanRound: false });
  assert.equal(roundCount(composed, full), 1);

  // The composer drops the Interview column. The plan still NAMES it until the
  // next save — and the server prunes that step on the very next read, so no AI
  // round can run. The preview must say so on every card: Overview already walks
  // the axis and shows nothing, and Schedule used to contradict it by promising
  // an AI docket and a round to book.
  const narrowed = full.filter((s) => s.id !== "Interview");
  const impact = deriveImpact(composed, narrowed);
  assert.deepEqual(impact.overview.flatMap((s) => s.rounds), [], "no station runs a round");
  assert.deepEqual(impact.schedule, { aiRound: false, humanRound: false }, "…so no Schedule surface is live");
  assert.equal(roundCount(composed, narrowed), 0, "…and there is nothing to book");
  // The server's own read agrees, which is the reading the preview must match.
  assert.equal(planRounds(prunePlanToAxis(composed, narrowed)).length, 0);

  // The other half of the same rule: a column that is still ON the axis but has
  // been re-roled to one that cannot hold policy. `prunePlanToAxis` drops it too,
  // so the preview must not draw a round at the terminal column.
  const reRoled = full.map((s) => (s.id === "Interview" ? { ...s, role: "terminal" as const } : s));
  const asTerminal = deriveImpact(composed, reRoled);
  assert.deepEqual(asTerminal.overview.flatMap((s) => s.rounds), [], "arrival and outcome run nothing");
  assert.deepEqual(asTerminal.schedule, { aiRound: false, humanRound: false });
  assert.equal(roundCount(composed, reRoled), 0);
});

test("a save sends the plan in BOARD order, so the reducer is judged against the round the candidate meets first", () => {
  // A second interview column added, then moved ABOVE the shipped one. The step
  // array still carries the columns in the order the reader TOUCHED them, because
  // the editor appends a step on first touch and never reorders.
  const axis: StageDef[] = [
    { id: "Accepted", label: "Accepted", role: "entry" },
    { id: "Screened", label: "Screened", role: "screening" },
    { id: "New step", label: "New step", role: "interview" },
    { id: "Interview", label: "Interview", role: "interview" },
    { id: "Offer", label: "Offer", role: "offer" },
    { id: "Hired", label: "Hired", role: "terminal" },
  ];
  const touched: PipelinePlan = {
    steps: [
      { stageId: "Screened", gate: "human", rounds: [] },
      // The board's SECOND interview column, so the editor offers it a cohort
      // reducer and the reader picks Top 3.
      { stageId: "Interview", gate: "human", rounds: [{ kind: "ai", gate: "human", topN: 3 }] },
      { stageId: "Offer", gate: "human", rounds: [] },
      { stageId: "New step", gate: "human", rounds: [{ kind: "ai", gate: "human", topN: null }] },
    ],
  };

  // Sent as touched, the validator numbers rounds by ARRAY position: Interview's
  // round looks like the plan's first, so its Top 3 is stripped and the save
  // reports success anyway. That is the defect.
  const asTouched = validateDecisionConfig("interviewPlan", touched);
  assert.equal(asTouched.ok, true);
  if (asTouched.ok && asTouched.phase === "interviewPlan") {
    assert.equal(planStep(asTouched.config, "Interview")!.rounds[0].topN, null, "array order strips the reducer");
  }

  // Sorted to the board first, the reducer lands where the composer offered it.
  const sent = validateDecisionConfig("interviewPlan", sortPlanToAxis(touched, axis));
  assert.equal(sent.ok, true);
  if (sent.ok && sent.phase === "interviewPlan") {
    assert.deepEqual(sent.config.steps.map((s) => s.stageId), ["Screened", "New step", "Interview", "Offer"]);
    assert.equal(planStep(sent.config, "New step")!.rounds[0].topN, null, "the first round has no cohort to reduce");
    assert.equal(planStep(sent.config, "Interview")!.rounds[0].topN, 3, "the second keeps the reducer the reader chose");
  }
});

test("sortPlanToAxis parks an off-axis step LAST rather than letting it claim round one", () => {
  const axis: StageDef[] = [
    { id: "In", label: "In", role: "entry" },
    { id: "R1", label: "R1", role: "interview" },
    { id: "Out", label: "Out", role: "terminal" },
  ];
  const stale: PipelinePlan = {
    steps: [
      { stageId: "Gone", gate: "human", rounds: [{ kind: "ai", gate: "human", topN: null }] },
      { stageId: "R1", gate: "human", rounds: [{ kind: "ai", gate: "human", topN: 5 }] },
    ],
  };
  // "Gone" is pruned on the next read, so it must not be the round that spends
  // the no-reducer exemption — R1 would then keep a topN it is not entitled to.
  assert.deepEqual(sortPlanToAxis(stale, axis).steps.map((s) => s.stageId), ["R1", "Gone"]);
  const sent = validateDecisionConfig("interviewPlan", sortPlanToAxis(stale, axis));
  assert.equal(sent.ok, true);
  if (sent.ok && sent.phase === "interviewPlan") {
    assert.equal(planStep(sent.config, "R1")!.rounds[0].topN, null, "the surviving column holds round one");
  }
});


// ---- stage-keyed migration -------------------------------------------------

test("the legacy plan migrates onto the columns it actually ran at", () => {
  const plan = migrateLegacyInterviewPlan({
    screeningGate: "auto",
    rounds: [
      { kind: "ai", gate: "human", topN: null },
      { kind: "human", gate: "human", topN: 3 },
    ],
    offerGate: "human",
  });
  // Only the three plannable columns get a step — never entry or terminal.
  assert.deepEqual(
    plan.steps.map((s) => s.stageId),
    ["Screened", "Interview", "Offer"]
  );
  assert.equal(plan.steps[0].gate, "auto", "screeningGate lands on the screening column");
  assert.equal(plan.steps[2].gate, "human", "offerGate lands on the offer column");
  // The shipped default's two rounds share ONE Interview column. The old code
  // stacked them there implicitly; the migration writes that down.
  assert.equal(plan.steps[1].rounds.length, 2, "both rounds land at the one interview column");
  assert.deepEqual(planRounds(plan).map((r) => r.kind), ["ai", "human"], "order survives");
});

test("migration spreads rounds across interview columns when the axis has them", () => {
  const axis = [
    { id: "Accepted", label: "Accepted", role: "entry" as const },
    { id: "Screened", label: "Screened", role: "screening" as const },
    { id: "First", label: "First", role: "interview" as const },
    { id: "Second", label: "Second", role: "interview" as const },
    { id: "Offer", label: "Offer", role: "offer" as const },
    { id: "Hired", label: "Hired", role: "terminal" as const },
  ];
  const plan = migrateLegacyInterviewPlan(
    {
      screeningGate: "human",
      rounds: [
        { kind: "ai", gate: "auto", topN: null },
        { kind: "human", gate: "human", topN: 3 },
      ],
      offerGate: "human",
    },
    axis
  );
  const byStage = Object.fromEntries(plan.steps.map((s) => [s.stageId, s]));
  assert.equal(byStage.First.rounds.length, 1, "round 1 → first interview column");
  assert.equal(byStage.Second.rounds.length, 1, "round 2 → second interview column");
  // An interview column's gate is its own round's gate — the per-column control
  // the flat shape could not express.
  assert.equal(byStage.First.gate, "auto");
  assert.equal(byStage.Second.gate, "human");
});

test("every screening column gets its own step — the defect that blocked the merge", () => {
  const axis = [
    { id: "Accepted", label: "Accepted", role: "entry" as const },
    { id: "Screened", label: "Screened", role: "screening" as const },
    { id: "Screened2", label: "Second screen", role: "screening" as const },
    { id: "Offer", label: "Offer", role: "offer" as const },
    { id: "Hired", label: "Hired", role: "terminal" as const },
  ];
  const plan = migrateLegacyInterviewPlan({ screeningGate: "auto", rounds: [], offerGate: "human" }, axis);
  const screening = plan.steps.filter((s) => s.stageId.startsWith("Screened"));
  assert.equal(screening.length, 2, "both screening columns are addressable");
  // They start equal because the legacy model had ONE gate for both — but they
  // are now separate values, so the merged editor can diverge them.
  assert.deepEqual(screening.map((s) => s.gate), ["auto", "auto"]);
});

test("rounds with no interview column to run at are dropped, not invented", () => {
  const axis = [
    { id: "Accepted", label: "Accepted", role: "entry" as const },
    { id: "Screened", label: "Screened", role: "screening" as const },
    { id: "Hired", label: "Hired", role: "terminal" as const },
  ];
  const plan = migrateLegacyInterviewPlan(
    { screeningGate: "human", rounds: [{ kind: "ai", gate: "human", topN: null }], offerGate: "human" },
    axis
  );
  assert.equal(planRounds(plan).length, 0, "the board has nowhere to draw them");
  assert.deepEqual(plan.steps.map((s) => s.stageId), ["Screened"], "and no offer step is fabricated");
});

test("a stored plan is pruned to the axis it is read against", () => {
  const plan = migrateLegacyInterviewPlan({
    screeningGate: "human",
    rounds: [{ kind: "ai", gate: "human", topN: null }],
    offerGate: "human",
  });
  // The workspace has since dropped its Interview column.
  const narrowed = [
    { id: "Accepted", label: "Accepted", role: "entry" as const },
    { id: "Screened", label: "Screened", role: "screening" as const },
    { id: "Offer", label: "Offer", role: "offer" as const },
    { id: "Hired", label: "Hired", role: "terminal" as const },
  ];
  const pruned = prunePlanToAxis(plan, narrowed);
  assert.deepEqual(pruned.steps.map((s) => s.stageId), ["Screened", "Offer"]);
  assert.equal(planRounds(pruned).length, 0, "the dropped column takes its rounds with it");
});

test("the stage-keyed validator refuses two policies for one column", () => {
  const dup = validateDecisionConfig("interviewPlan", {
    steps: [
      { stageId: "Screened", gate: "human", rounds: [] },
      { stageId: "Screened", gate: "auto", rounds: [] },
    ],
  });
  assert.equal(dup.ok, false, "whichever won would be arbitrary");
  const ok = validateDecisionConfig("interviewPlan", {
    steps: [{ stageId: "Screened", gate: "auto", rounds: [] }],
  });
  assert.equal(ok.ok, true);
});

test("the rounds cap counts the whole plan, not one column", () => {
  const round = { kind: "ai", gate: "human", topN: null };
  const over = validateDecisionConfig("interviewPlan", {
    steps: [
      { stageId: "A", gate: "human", rounds: [round, round] },
      { stageId: "B", gate: "human", rounds: [round, round] },
    ],
  });
  assert.equal(over.ok, false, "spreading rounds over columns is still interviewing");
});

test("the plan's FIRST round carries no cohort reducer, wherever it sits", () => {
  const result = validateDecisionConfig("interviewPlan", {
    steps: [
      { stageId: "A", gate: "human", rounds: [{ kind: "ai", gate: "human", topN: 5 }] },
      { stageId: "B", gate: "human", rounds: [{ kind: "ai", gate: "human", topN: 5 }] },
    ],
  });
  assert.equal(result.ok, true);
  if (result.ok && result.phase === "interviewPlan") {
    const rounds = planRounds(result.config);
    // The rule is about the candidate's journey, so the counter must not reset
    // at each column — only the very first round in the plan is exempt.
    assert.equal(rounds[0].topN, null);
    assert.equal(rounds[1].topN, 5);
  }
});
