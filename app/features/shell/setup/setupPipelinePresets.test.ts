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
import { axisProblems, draftFromStored, draftToStored, removeStage, renameStage } from "@/app/features/shared/pipelineAxisDraft";
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
