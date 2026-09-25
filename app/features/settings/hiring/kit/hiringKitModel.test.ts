// Settings > Hiring's kit view: the data-to-rows mapping. Each assertion pins that the kit REUSES
// the current tab's rules (pipelineAxisDraft's label problems, PipelineStepPolicy's slots and
// defaults, deriveImpact's decisions, HiringTab's save sentence) and only adds its own reading:
// which rows exist, which of them changed against the stored plan, which mark a column wears.
//
// Runner: Node's built-in test runner with type stripping - npm run test:unit
import test from "node:test";
import assert from "node:assert/strict";
import { INTERVIEW_PLAN_DEFAULT, PIPELINE_STAGES_DEFAULT } from "@/app/_lib/decision-config-schema";
import type { StageDef } from "@/app/_lib/pipeline-stages";
import { addStage, draftFromStored, moveStage, removeStage, renameStage, setStageActions } from "@/app/features/shared/pipelineAxisDraft";
import type { PipelinePlan } from "../pipelineComposerModel";
import {
  actionRows,
  latestVersion,
  matrixRows,
  planFigures,
  policyRows,
  saveStatusKey,
  setPolicy,
  stepRows,
  strandedRows,
} from "./hiringKitModel";

const SAVED = PIPELINE_STAGES_DEFAULT.stages as StageDef[];
const PLAN = INTERVIEW_PLAN_DEFAULT as PipelinePlan;
const draft = () => draftFromStored(PIPELINE_STAGES_DEFAULT);

test("a stored axis maps to one unchanged row per column, occupancy null until it lands", () => {
  const rows = stepRows(draft(), SAVED, { Screened: 20 }, false);
  assert.deepEqual(rows.map((r) => r.id), ["Accepted", "Screened", "Interview", "Offer", "Hired"]);
  assert.ok(rows.every((r) => !r.changed && !r.invalid && r.count === null));
  assert.equal(rows[0].first, true);
  assert.equal(rows[4].last, true);
  const loaded = stepRows(draft(), SAVED, { Screened: 20 }, true);
  assert.equal(loaded[1].count, 20);
  assert.equal(loaded[0].count, 0, "a landed read with no entry for a column is a real zero");
});

test("rename, move, re-scope, remove and add each mark exactly the rows they touch as changed", () => {
  const renamed = stepRows(renameStage(draft(), "Screened", "Phone screen"), SAVED, {}, true);
  assert.deepEqual(renamed.filter((r) => r.changed).map((r) => r.id), ["Screened"]);
  const moved = stepRows(moveStage(draft(), "Interview", -1), SAVED, {}, true);
  assert.deepEqual(moved.filter((r) => r.changed).map((r) => r.id), ["Interview", "Screened"]);
  const scoped = stepRows(setStageActions(draft(), "Offer", ["offer"]), SAVED, {}, true);
  assert.deepEqual(scoped.filter((r) => r.changed).map((r) => r.id), ["Offer"]);
  const removed = stepRows(removeStage(draft(), "Offer"), SAVED, {}, true);
  assert.deepEqual(removed.filter((r) => r.changed).map((r) => r.id), [], "a removal moves nobody else");
  const added = stepRows(addStage(draft(), "New step"), SAVED, { Accepted: 3 }, true);
  const fresh = added.find((r) => !r.saved)!;
  assert.equal(fresh.changed, true);
  assert.equal(fresh.count, 0, "a draft-only step holds nobody");
});

test("an empty or repeated name is invalid on its own row (axisProblems' two label rules)", () => {
  const dup = stepRows(renameStage(draft(), "Offer", " interview "), SAVED, {}, true);
  assert.deepEqual(dup.filter((r) => r.invalid).map((r) => r.id), ["Interview", "Offer"]);
  const empty = stepRows(renameStage(draft(), "Offer", "  "), SAVED, {}, true);
  assert.deepEqual(empty.filter((r) => r.invalid).map((r) => r.id), ["Offer"]);
});

test("policy rows follow the column type: one guard per gated step, executor + guard on the first interview", () => {
  const rows = policyRows(PLAN, PLAN, SAVED);
  assert.deepEqual(rows.map((r) => r.key), ["Screened:guard", "Interview:executor", "Interview:guard", "Offer:guard"]);
  assert.ok(rows.every((r) => !r.changed));
  // Entry and terminal carry nothing; the first round has no previous cohort, so no cohort row.
  assert.ok(!rows.some((r) => r.dim === "cohort"));
});

test("a later interview offers the cohort; a human round's guard is the scorecard, muted", () => {
  const axis: StageDef[] = [...SAVED.slice(0, 3), { id: "Panel", label: "Panel", role: "interview" }, ...SAVED.slice(3)];
  const plan = setPolicy(PLAN, { stageId: "Panel", role: "interview", dim: "executor" }, "human");
  const rows = policyRows(plan, PLAN, axis).filter((r) => r.stageId === "Panel");
  assert.deepEqual(rows.map((r) => r.dim), ["cohort", "executor", "scorecard"]);
  assert.equal(rows[1].changed, true);
  const topped = policyRows(setPolicy(plan, rows[0], 3), PLAN, axis).find((r) => r.key === "Panel:cohort")!;
  assert.equal(topped.value, 3);
  assert.equal(topped.changed, true);
});

test("an untouched column reads its conservative default and its first edit writes the step", () => {
  const plan: PipelinePlan = { steps: [] };
  const rows = policyRows(plan, plan, SAVED);
  assert.equal(rows.find((r) => r.key === "Screened:guard")!.value, "human");
  assert.equal(rows.find((r) => r.key === "Interview:executor")!.value, "ai");
  const next = setPolicy(plan, { stageId: "Interview", role: "interview", dim: "guard" }, "auto");
  assert.deepEqual(next.steps, [{ stageId: "Interview", gate: "auto", rounds: [{ kind: "ai", gate: "auto", topN: null }] }]);
});

test("a legacy stacked column says so on its executor row", () => {
  const plan: PipelinePlan = { steps: [{ stageId: "Interview", gate: "human", rounds: [{ kind: "ai", gate: "human", topN: null }, { kind: "human", gate: "human", topN: 3 }] }] };
  assert.equal(policyRows(plan, plan, SAVED).find((r) => r.dim === "executor")!.stacked, 2);
});

test("the head's figures count against the stored plan (deriveImpact)", () => {
  const auto = setPolicy(PLAN, { stageId: "Screened", role: "screening", dim: "guard" }, "auto");
  assert.deepEqual(planFigures(auto, SAVED, PLAN, SAVED), { decisions: 2, decisionsDelta: -1, rounds: 1, roundsDelta: 0 });
});

test("the matrix: one row per step carrying its own decisions, its mark as the controls show it", () => {
  const rows = matrixRows(draft(), SAVED, { Offer: 43 }, true, PLAN, PLAN);
  assert.deepEqual(rows.map((r) => [r.id, r.decider, r.policy.map((p) => p.dim).join("+")]), [
    ["Accepted", "nobody", ""],
    ["Screened", "human", "guard"],
    ["Interview", "human", "executor+guard"],
    ["Offer", "human", "guard"],
    ["Hired", "nobody", ""],
  ]);
  assert.equal(rows[3].count, 43);
  assert.ok(rows.every((r) => !r.dirty && r.stacked === null));
  const auto = setPolicy(PLAN, { stageId: "Screened", role: "screening", dim: "guard" }, "auto");
  const edited = matrixRows(draft(), SAVED, {}, true, auto, PLAN);
  assert.equal(edited[1].decider, "machine");
  assert.deepEqual(edited.filter((r) => r.dirty).map((r) => r.id), ["Screened"], "a decision edit marks its own step row");
  const human = setPolicy(PLAN, { stageId: "Interview", role: "interview", dim: "executor" }, "human");
  assert.equal(matrixRows(draft(), SAVED, {}, true, human, PLAN)[2].decider, "human", "a human round's verdict is a person deciding");
});

test("a legacy stacked column carries its count on the step row", () => {
  const plan: PipelinePlan = { steps: [{ stageId: "Interview", gate: "human", rounds: [{ kind: "ai", gate: "human", topN: null }, { kind: "human", gate: "human", topN: 3 }] }] };
  assert.equal(matrixRows(draft(), SAVED, {}, true, plan, plan)[2].stacked, 2);
});

test("saved-on reads the latest of the two phases; never saved when neither was", () => {
  assert.equal(latestVersion({ pipelineStages: null, interviewPlan: "2026-08-10T09:00:00Z" }, ["pipelineStages", "interviewPlan"]), "2026-08-10T09:00:00Z");
  assert.equal(latestVersion({ pipelineStages: "2026-09-01T00:00:00Z", interviewPlan: "2026-08-10T09:00:00Z" }, ["pipelineStages", "interviewPlan"]), "2026-09-01T00:00:00Z");
  assert.equal(latestVersion({ pipelineStages: null, interviewPlan: null }, ["pipelineStages", "interviewPlan"]), null);
});

test("AI actions follow the default until the step sets its own list", () => {
  const rows = actionRows(setStageActions(draft(), "Offer", []).stages);
  const offer = rows.find((r) => r.id === "Offer")!;
  assert.deepEqual(offer.current, []);
  assert.equal(offer.custom, true);
  assert.ok(offer.defaults.length > 0);
  assert.equal(rows.find((r) => r.id === "Screened")!.custom, false);
});

test("a stranded group is unmapped until its destination is still on the draft", () => {
  const stages = draft().stages;
  const stranded = [{ stage: { id: "Gone", label: "Gone", role: "custom" as const }, count: 4 }];
  assert.equal(strandedRows(stranded, {}, stages)[0].unmapped, true);
  assert.equal(strandedRows(stranded, { Gone: "Offer" }, stages)[0].unmapped, false);
  assert.equal(strandedRows(stranded, { Gone: "Nowhere" }, stages)[0].unmapped, true);
});

test("the save sentence: the refusal reason wins over 'unsaved'", () => {
  assert.equal(saveStatusKey("occupancy", true), "blockedOccupancy");
  assert.equal(saveStatusKey("unmapped", true), "blockedStranded");
  assert.equal(saveStatusKey("problems", true), "blocked");
  assert.equal(saveStatusKey(null, true), "unsaved");
  assert.equal(saveStatusKey(null, false), "allSaved");
});
