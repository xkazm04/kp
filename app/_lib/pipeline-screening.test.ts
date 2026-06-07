// Pins the Accepted-stage triage contract (idea-17ede48f): the funnel entry stage
// gets an individually-actionable "Screen with AI", routed through the same
// screening machinery as Screened. These tests lock WHAT a manual screen does at
// each stage so the drawer gate (CandidateDrawer ACTIONS), the apply boundary
// (automation-run.ts), and the canonical set never drift apart.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PIPELINE_STAGES,
  SCREENING_STAGES,
  isScreeningStage,
  screenStageOutcome,
  hasAdvancedPastScreening,
} from "./pipeline-stages.ts";

test("the screening stages are exactly the pre-interview stages (Accepted, Screened)", () => {
  assert.deepEqual([...SCREENING_STAGES], ["Accepted", "Screened"]);
});

test("a screening stage is precisely a stage that has NOT advanced past screening", () => {
  // The two notions are kept in lockstep: a manual screen is meaningful exactly
  // where the candidate has not yet cleared the screening gate.
  for (const stage of PIPELINE_STAGES) {
    assert.equal(isScreeningStage(stage), !hasAdvancedPastScreening(stage), stage);
  }
});

test("isScreeningStage rejects post-screening and unknown stages", () => {
  assert.equal(isScreeningStage("Accepted"), true);
  assert.equal(isScreeningStage("Screened"), true);
  assert.equal(isScreeningStage("Interview"), false);
  assert.equal(isScreeningStage("Offer"), false);
  assert.equal(isScreeningStage("Hired"), false);
  assert.equal(isScreeningStage("Sourced"), false);
  assert.equal(isScreeningStage(""), false);
});

test("Accepted always screens a fresh applicant INTO Screened, never rejects", () => {
  // A clean advance lands them in Screened ready for the interview gate...
  assert.deepEqual(screenStageOutcome("Accepted", "advance"), {
    advance: true,
    holdForReview: false,
    applied: "advanced",
  });
  // ...a cautious hold STILL moves them into Screened (the fair, never-block
  // Accepted→Screened move) but flags a review so a human resolves it in Decisions.
  assert.deepEqual(screenStageOutcome("Accepted", "hold"), {
    advance: true,
    holdForReview: true,
    applied: "held_for_review",
  });
});

test("Screened advances to Interview on a clean pass, else holds in place for review", () => {
  assert.deepEqual(screenStageOutcome("Screened", "advance"), {
    advance: true,
    holdForReview: false,
    applied: "advanced",
  });
  assert.deepEqual(screenStageOutcome("Screened", "hold"), {
    advance: false,
    holdForReview: true,
    applied: "held_for_review",
  });
});

test("an off-set / missing route never auto-advances — it holds for review", () => {
  // Mirrors coerceScreenRoute's safe default: anything other than "advance" holds.
  for (const route of ["", "reject", "maybe", "ADVANCE"]) {
    assert.equal(screenStageOutcome("Screened", route).advance, false, route);
    assert.equal(screenStageOutcome("Screened", route).holdForReview, true, route);
  }
  // Accepted still moves into Screened on any route (the move never rejects), but
  // an unclear route flags it for review rather than clearing it.
  assert.deepEqual(screenStageOutcome("Accepted", "reject"), {
    advance: true,
    holdForReview: true,
    applied: "held_for_review",
  });
});

test("a non-screening stage is advisory only — nothing moves", () => {
  for (const stage of ["Interview", "Offer", "Hired"]) {
    assert.deepEqual(screenStageOutcome(stage, "advance"), {
      advance: false,
      holdForReview: false,
      applied: "advisory",
    });
  }
});
