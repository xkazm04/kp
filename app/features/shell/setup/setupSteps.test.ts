import test from "node:test";
import assert from "node:assert/strict";
import { INITIAL_SETUP, reachedCeiling, SETUP_STEPS, stepSatisfied, type SetupState } from "./setupSteps";
import { draftFromStored } from "@/app/features/shared/pipelineAxisDraft";
import type { PipelineStagesRule } from "@/app/_lib/decision-config-schema";

// The two gates the whole wizard hangs off — one decides whether Continue is
// live, the other decides which steps a click may open — and neither was pinned.

const STORED: PipelineStagesRule = {
  stages: [
    { id: "applied", label: "Applied", role: "entry" },
    { id: "interview", label: "Interview", role: "interview" },
    { id: "hired", label: "Hired", role: "terminal" },
  ],
  retired: [],
} as unknown as PipelineStagesRule;

function withBoard(over: Partial<SetupState> = {}): SetupState {
  return {
    ...INITIAL_SETUP,
    pipelineLoad: "ready",
    pipeline: { stored: STORED, draft: draftFromStored(STORED), counts: {} },
    ...over,
  };
}

test("the org name is the wizard's ONE required input", () => {
  assert.equal(stepSatisfied("company", INITIAL_SETUP), false);
  assert.equal(stepSatisfied("company", { ...INITIAL_SETUP, orgName: "   " }), false, "whitespace is not a name");
  assert.equal(stepSatisfied("company", { ...INITIAL_SETUP, orgName: "Acme" }), true);
});

test("welcome, team and companion are always satisfied — each ships a real default answer", () => {
  for (const id of ["welcome", "team", "companion", "handoff"] as const) {
    assert.equal(stepSatisfied(id, INITIAL_SETUP), true, id);
  }
});

test("the pipeline gate is a VALIDITY check, not a completeness one", () => {
  // An untouched board is a legitimate answer, so an unloaded/loading axis passes.
  assert.equal(stepSatisfied("pipeline", INITIAL_SETUP), true);
  assert.equal(stepSatisfied("pipeline", { ...INITIAL_SETUP, pipelineLoad: "failed" }), true);
  assert.equal(stepSatisfied("pipeline", withBoard()), true);
});

test("an axis the server would reject cannot be carried to the hand-off", () => {
  const board = withBoard();
  const broken = { ...board.pipeline!, draft: { ...board.pipeline!.draft, stages: [] } };
  assert.equal(stepSatisfied("pipeline", { ...board, pipeline: broken }), false);
});

/* ── the reachable ceiling ────────────────────────────────────────────────── */

test("a satisfied step keeps the whole high-water mark", () => {
  assert.equal(reachedCeiling(4, 1, true), 4);
});

test("clearing a required input REVOKES the steps it bought", () => {
  // Typed the org name, pressed Continue to step 3, came back and cleared it: the
  // rail must not still offer Team/Pipeline/Done, because finishing that way
  // writes no org name at all and the workspace keeps the seed default.
  assert.equal(reachedCeiling(4, 1, false), 1);
});

test("going BACK is never capped — nobody is stranded", () => {
  assert.equal(reachedCeiling(4, 5, false), 4);
  assert.equal(reachedCeiling(0, 0, false), 0);
});

test("every step id in the journey has a satisfaction rule", () => {
  for (const s of SETUP_STEPS) assert.equal(typeof stepSatisfied(s.id, INITIAL_SETUP), "boolean", s.id);
});
