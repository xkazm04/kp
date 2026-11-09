import assert from "node:assert/strict";
import test from "node:test";
import type { InterviewPlanRule } from "@/app/_lib/decision-config-schema";
import { planMarkText, stagePlanMark } from "./pipelinePlanMarks";

const PLAN: InterviewPlanRule = {
  steps: [
    { stageId: "screen", gate: "auto", rounds: [] },
    { stageId: "iv", gate: "human", rounds: [{ kind: "ai", gate: "auto", topN: null }] },
    { stageId: "final", gate: "auto", rounds: [{ kind: "human", gate: "human", topN: null }, { kind: "ai", gate: "auto", topN: 3 }] },
  ],
};
const STAGES = ["new", "screen", "iv", "final"];

/** What the ring key hands the mark for one stage, with stand-in labels (the real ones come from next-intl). */
function draw(plan: InterviewPlanRule | null, stageId: string) {
  return planMarkText(plan, stageId, (k) => (k === "humanGate" ? "human gate" : k));
}

test("a human-gate stage draws the stop marker; the other stages draw none", () => {
  const gated = STAGES.filter((id) => draw(PLAN, id)?.gate === "human gate");
  assert.deepEqual(gated, ["iv"]);
});

test("the executor the plan assigns is read per stage; a stage the plan is silent on has no mark", () => {
  assert.equal(stagePlanMark(PLAN, "iv")?.executor, "ai");
  assert.equal(stagePlanMark(PLAN, "final")?.executor, "mixed");
  assert.equal(stagePlanMark(PLAN, "screen")?.executor, null);
  assert.equal(stagePlanMark(PLAN, "new"), null);
});

test("a null plan (before the first load) draws nothing and does not throw", () => {
  for (const id of STAGES) assert.equal(draw(null, id), null);
  assert.equal(stagePlanMark(undefined, "iv"), null);
});
