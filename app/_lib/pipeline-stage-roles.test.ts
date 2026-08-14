// The stage-ROLE layer (P1): meaning lives on `role`, never on a stage's name.
//
// The board's columns are becoming workspace-editable, and almost every rule in
// the product used to read a literal — `indexOf(stage) >= indexOf("Interview")`
// for the fairness metric, `s !== "Hired"` for the move menu, a hardcoded
// SCREENING_STAGES pair for the AI-screen gate. Under an editable axis those
// silently answer a different question after a rename or a reorder.
//
// Two things are asserted here. First, that the role layer reproduces today's
// answers EXACTLY on the default axis — this pass must be a no-op at runtime.
// Second, that it keeps answering correctly on axes the default one cannot
// express, which is the whole point of introducing it.
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_STAGE_AXIS,
  hasAdvancedPastScreening,
  isScreeningStage,
  PIPELINE_STAGES,
  SCREENING_STAGES,
  screeningGateIndex,
  screeningStageIds,
  stageIndex,
  stageWithRole,
  stagesWithRole,
  STAGE_ROLE,
  type StageDef,
} from "./pipeline-stages.ts";

// ---- The default axis is exactly the shipped board -------------------------

test("DEFAULT_STAGE_AXIS is PIPELINE_STAGES, in order, with ids equal to the stored names", () => {
  assert.deepEqual(
    DEFAULT_STAGE_AXIS.map((s) => s.id),
    [...PIPELINE_STAGES]
  );
  // id === the value already in pipeline_entries.stage, so introducing StageDef
  // requires NO data migration. Labels diverge from ids only once a workspace can
  // rename a column.
  for (const stage of DEFAULT_STAGE_AXIS) assert.equal(stage.label, stage.id);
});

test("every canonical stage carries a role, and the unique roles are unique", () => {
  for (const id of PIPELINE_STAGES) assert.ok(STAGE_ROLE[id], `${id} needs a role`);
  assert.equal(stagesWithRole("entry").length, 1);
  assert.equal(stagesWithRole("terminal").length, 1);
  assert.equal(stagesWithRole("offer").length, 1);
  assert.equal(stageWithRole("entry"), "Accepted");
  assert.equal(stageWithRole("terminal"), "Hired");
  assert.equal(stageWithRole("offer"), "Offer");
});

// ---- Byte-identical to the pre-P1 behaviour --------------------------------

test("hasAdvancedPastScreening still means 'reached Interview or beyond'", () => {
  assert.equal(hasAdvancedPastScreening("Accepted"), false);
  assert.equal(hasAdvancedPastScreening("Screened"), false);
  assert.equal(hasAdvancedPastScreening("Interview"), true);
  assert.equal(hasAdvancedPastScreening("Offer"), true);
  assert.equal(hasAdvancedPastScreening("Hired"), true);
  // An off-axis (legacy) stage has not advanced past anything — the old
  // indexOf-based form returned -1 >= 2 = false, and so does this one.
  assert.equal(hasAdvancedPastScreening("Sourced"), false);
});

test("the screening stages derived from roles equal the hand-written SCREENING_STAGES", () => {
  assert.deepEqual(screeningStageIds(), [...SCREENING_STAGES]);
  assert.equal(isScreeningStage("Accepted"), true);
  assert.equal(isScreeningStage("Screened"), true);
  assert.equal(isScreeningStage("Interview"), false);
  assert.equal(isScreeningStage("Hired"), false);
  assert.equal(isScreeningStage("Sourced"), false, "an off-axis stage is not a screening stage");
});

test("screening stages and 'past screening' partition the axis with no overlap or gap", () => {
  for (const id of PIPELINE_STAGES) {
    assert.notEqual(
      isScreeningStage(id),
      hasAdvancedPastScreening(id),
      `${id} must be exactly one of screening / past-screening`
    );
  }
});

// ---- Axes the default one cannot express -----------------------------------

const axis = (...defs: Array<[string, StageDef["role"]]>): StageDef[] =>
  defs.map(([id, role]) => ({ id, label: id, role }));

test("renaming every stage changes nothing: the gate follows the role", () => {
  const renamed = axis(
    ["new-applicants", "entry"],
    ["triaged", "screening"],
    ["meeting", "interview"],
    ["package", "offer"],
    ["signed", "terminal"]
  );
  assert.equal(screeningGateIndex(renamed), 2);
  assert.deepEqual(screeningStageIds(renamed), ["new-applicants", "triaged"]);
  assert.equal(hasAdvancedPastScreening("triaged", renamed), false);
  assert.equal(hasAdvancedPastScreening("meeting", renamed), true);
  assert.equal(stageWithRole("terminal", renamed), "signed");
});

test("splitting the interview column keeps the gate at the FIRST interview stage", () => {
  const split = axis(
    ["Accepted", "entry"],
    ["Screened", "screening"],
    ["Tech screen", "interview"],
    ["Onsite", "interview"],
    ["Offer", "offer"],
    ["Hired", "terminal"]
  );
  assert.equal(screeningGateIndex(split), 2);
  assert.equal(hasAdvancedPastScreening("Tech screen", split), true, "the first round already counts as a real look");
  assert.equal(hasAdvancedPastScreening("Onsite", split), true);
  assert.deepEqual(stagesWithRole("interview", split), ["Tech screen", "Onsite"]);
});

test("extra screening stages all sit BEFORE the gate", () => {
  const extra = axis(
    ["Accepted", "entry"],
    ["Auto-screen", "screening"],
    ["Recruiter review", "screening"],
    ["Interview", "interview"],
    ["Hired", "terminal"]
  );
  assert.deepEqual(screeningStageIds(extra), ["Accepted", "Auto-screen", "Recruiter review"]);
  assert.equal(hasAdvancedPastScreening("Recruiter review", extra), false);
});

test("a custom stage participates in ordering and claims no semantics", () => {
  const withCustom = axis(
    ["Accepted", "entry"],
    ["Screened", "screening"],
    ["Reference check", "custom"],
    ["Interview", "interview"],
    ["Hired", "terminal"]
  );
  // The custom stage sits before the first interview stage, so it is pre-gate.
  assert.equal(screeningGateIndex(withCustom), 3);
  assert.equal(hasAdvancedPastScreening("Reference check", withCustom), false);
  assert.equal(stageIndex("Reference check", withCustom), 2);
});

test("an axis with no interview stage falls back to offer, then terminal, then nobody", () => {
  const noInterview = axis(["Accepted", "entry"], ["Screened", "screening"], ["Offer", "offer"], ["Hired", "terminal"]);
  assert.equal(screeningGateIndex(noInterview), 2, "offer becomes the gate");
  assert.equal(hasAdvancedPastScreening("Offer", noInterview), true);

  const onlyTerminal = axis(["Accepted", "entry"], ["Hired", "terminal"]);
  assert.equal(screeningGateIndex(onlyTerminal), 1);

  const nothing = axis(["Accepted", "entry"], ["Screened", "screening"]);
  assert.equal(screeningGateIndex(nothing), 2, "no gate stage: nobody is past it");
  assert.equal(hasAdvancedPastScreening("Screened", nothing), false);
});
