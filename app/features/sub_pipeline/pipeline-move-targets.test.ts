// Pins the board move-menu's target-stage contract (bug-ui pipeline #1): the
// keyboard "Move to…" affordance must offer exactly the stages a manual set_stage
// move can succeed into, so the accessible twin of drag is never a dead control.
//
// Non-vacuity: `moveTargetStages` / this whole module did not exist before the
// fix — against pre-fix code the import below is ERR_MODULE_NOT_FOUND and the file
// errors out (RED). Beyond mere existence, the assertions below discriminate the
// fix's decisions (Hired dropped, current stage dropped, funnel order kept): a
// naive `return PIPELINE_STAGES.slice()` passes tsc but fails every case here.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import { PIPELINE_STAGES } from "@/app/_lib/pipeline-stages.ts";
import { moveTargetStages } from "./pipeline-move-targets.ts";

test("never offers Hired as a target — the route 422s a manual move to Hired", () => {
  for (const stage of PIPELINE_STAGES) {
    assert.ok(
      !moveTargetStages(stage).includes("Hired"),
      `Hired must not be a move target from ${stage} (server rejects it)`
    );
  }
});

test("never offers the current stage (moving to the same column is a no-op)", () => {
  for (const stage of PIPELINE_STAGES) {
    assert.ok(!moveTargetStages(stage).includes(stage), `${stage} must not target itself`);
  }
});

test("from Accepted, offers Screened, Interview, Offer — in funnel order", () => {
  assert.deepEqual(moveTargetStages("Accepted"), ["Screened", "Interview", "Offer"]);
});

test("from Interview, offers Accepted, Screened, Offer — backward moves included", () => {
  assert.deepEqual(moveTargetStages("Interview"), ["Accepted", "Screened", "Offer"]);
});

test("from Hired, offers every non-Hired stage (a card CAN move back out of Hired)", () => {
  assert.deepEqual(moveTargetStages("Hired"), ["Accepted", "Screened", "Interview", "Offer"]);
});

test("an unknown/legacy stage yields every non-Hired stage, in axis order", () => {
  assert.deepEqual(moveTargetStages("Sourced"), ["Accepted", "Screened", "Interview", "Offer"]);
});

test("targets are always a subset of the canonical axis (no invented stages)", () => {
  const axis = new Set<string>(PIPELINE_STAGES);
  for (const stage of [...PIPELINE_STAGES, "Sourced"]) {
    for (const target of moveTargetStages(stage)) assert.ok(axis.has(target), `${target} is not a real stage`);
  }
});
