// The wizard's funnel shapes, and the gate that lets one leave the step.
//
// Two properties are pinned, because both are things a first-run reader cannot
// check for themselves:
//
//  1. every preset produces an axis the SERVER would accept — the wizard must not
//     be able to hand someone a shape that fails at finish (the presets are the
//     one-click path, so a broken one is a broken first run);
//  2. `stepSatisfied("pipeline", …)` blocks exactly the invalid drafts and nothing
//     else — an untouched axis, and a workspace whose axis could not be read, both
//     stay free to continue.
import test from "node:test";
import assert from "node:assert/strict";
import { validateDecisionConfig, type PipelineStagesRule } from "@/app/_lib/decision-config-schema";
import { DEFAULT_STAGE_AXIS } from "@/app/_lib/pipeline-stages";
import { addStage, AXIS_MAX_STAGES, axisProblems, draftFromStored, draftToStored, removeStage, renameStage } from "@/app/features/shared/pipelineAxisDraft";
import { activePipelinePreset, applyPipelinePreset, SETUP_PIPELINE_PRESETS } from "./setupPipelinePresets.ts";
import { INITIAL_SETUP, stepSatisfied, type SetupState } from "./setupSteps.ts";

const SHIPPED: PipelineStagesRule = {
  stages: DEFAULT_STAGE_AXIS.map((s) => ({ id: s.id, label: s.label, role: s.role as "entry" })),
  retired: [],
};
const BASE = draftFromStored(SHIPPED);
const WORK_SAMPLE = "Work sample";

test("every preset yields an axis the server accepts", () => {
  for (const key of SETUP_PIPELINE_PRESETS) {
    const draft = applyPipelinePreset(key, BASE, WORK_SAMPLE);
    assert.deepEqual(axisProblems(draft), [], `${key} should be locally valid`);
    const validated = validateDecisionConfig("pipelineStages", draftToStored(draft, DEFAULT_STAGE_AXIS));
    assert.equal(validated.ok, true, `${key} should validate server-side`);
  }
});

test("recommended is the loaded axis, untouched", () => {
  assert.deepEqual(applyPipelinePreset("recommended", BASE, WORK_SAMPLE), BASE);
});

test("lean keeps entry, ONE interview and terminal, in that order", () => {
  const lean = applyPipelinePreset("lean", BASE, WORK_SAMPLE);
  assert.deepEqual(
    lean.stages.map((s) => s.role),
    ["entry", "interview", "terminal"]
  );
  // Canonical ids survive: a preset edits the axis, it does not mint a new board.
  assert.deepEqual(
    lean.stages.map((s) => s.id),
    ["Accepted", "Interview", "Hired"]
  );
});

test("the work-sample step lands BEFORE the offer, with a locale-independent id", () => {
  const technical = applyPipelinePreset("technical", BASE, "Praktická úloha");
  const ids = technical.stages.map((s) => s.id);
  assert.equal(ids.length, DEFAULT_STAGE_AXIS.length + 1);
  assert.ok(ids.indexOf("Work sample") < ids.indexOf("Offer"), "the case comes before the offer");
  // The LABEL is the localized one the caller passed; the stored key is ASCII.
  const added = technical.stages.find((s) => s.id === "Work sample");
  assert.equal(added?.label, "Praktická úloha");
  assert.equal(added?.saved, false);
});

// The wizard also runs over an EXISTING board (Settings → "Preview onboarding"),
// where the axis is whatever that workspace composed. A preset is the one-click
// path, so it must never leave the step's Continue dead — which is exactly what an
// axis with a problem does (stepSatisfied reads axisProblems).
test("the work-sample preset never produces a board the step would refuse", () => {
  const gate = (draft: SetupState["pipeline"]): boolean =>
    stepSatisfied("pipeline", { ...INITIAL_SETUP, pipeline: draft, pipelineLoad: "ready" });

  // A workspace that already has a step by this name: a second one would be two
  // columns nobody can tell apart on the board.
  const withCase = addStage(BASE, WORK_SAMPLE);
  const overCase = applyPipelinePreset("technical", withCase, WORK_SAMPLE);
  assert.deepEqual(axisProblems(overCase), []);
  assert.equal(gate({ stored: SHIPPED, draft: overCase, counts: {} }), true);
  assert.equal(overCase.stages.length, withCase.stages.length, "the column it adds is already there");

  // A workspace already at the cap: there is no room for another column.
  let full = BASE;
  while (full.stages.length < AXIS_MAX_STAGES) full = addStage(full, `Round ${full.stages.length}`);
  const overFull = applyPipelinePreset("technical", full, WORK_SAMPLE);
  assert.deepEqual(axisProblems(overFull), []);
  assert.equal(gate({ stored: SHIPPED, draft: overFull, counts: {} }), true);
  assert.equal(overFull.stages.length, AXIS_MAX_STAGES);

  // …and the normal case still adds it (the guards are narrow, not a disabling).
  assert.equal(applyPipelinePreset("technical", BASE, WORK_SAMPLE).stages.length, BASE.stages.length + 1);
});

test("a rename keeps the picked shape selected; a structural edit deselects it", () => {
  const technical = applyPipelinePreset("technical", BASE, WORK_SAMPLE);
  assert.equal(activePipelinePreset(technical, BASE, WORK_SAMPLE), "technical");
  // Renaming is the customization the step invites — it must not silently
  // unpick the shape the operator chose.
  const renamed = renameStage(technical, "Screened", "First look");
  assert.equal(activePipelinePreset(renamed, BASE, WORK_SAMPLE), "technical");
  // Dropping a column is a different funnel, and none of the three presets.
  const handEdited = removeStage(BASE, "Screened");
  assert.equal(activePipelinePreset(handEdited, BASE, WORK_SAMPLE), null);
});

test("the step's gate blocks an invalid draft and nothing else", () => {
  const ready = (draft: SetupState["pipeline"]): SetupState => ({
    ...INITIAL_SETUP,
    pipeline: draft,
    pipelineLoad: "ready",
  });
  const loaded = { stored: SHIPPED, draft: BASE, counts: {} };
  assert.equal(stepSatisfied("pipeline", ready(loaded)), true);

  // Two columns with the same name: legal on the wire, refused by the editor
  // (you cannot tell them apart on a board), so Continue must be refused too.
  const duplicated = { ...loaded, draft: renameStage(BASE, "Screened", "Interview") };
  assert.equal(stepSatisfied("pipeline", ready(duplicated)), false);

  // Never a dead end: a failed read leaves the operator free to continue.
  assert.equal(stepSatisfied("pipeline", { ...INITIAL_SETUP, pipelineLoad: "failed" }), true);
  // …and so does a read still in flight.
  assert.equal(stepSatisfied("pipeline", { ...INITIAL_SETUP, pipelineLoad: "loading" }), true);
});
