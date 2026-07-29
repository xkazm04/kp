// bug-ui-scan-2026-07-09 (guided-pipeline-simulation #4): pin the phase-step state
// mapping the ControlDock feeds into each step's accessible name. Non-vacuity: the
// pre-fix JSX had only two booleans (done/active) and NO "upcoming" state at all, so
// an upcoming step announced no state — the `phaseStepState(...) === "upcoming"`
// assertions below have no pre-fix equivalent to satisfy. The precedence assertions
// (active loses to done when the run finishes; current only while not done) also fail
// against a naive "activeIdx === index → current" reading.
import { test } from "node:test";
import assert from "node:assert/strict";
import { phaseStepState } from "./phaseStep.ts";

test("the active phase is 'current' while the run is in flight", () => {
  assert.equal(phaseStepState({ activeIdx: 3, index: 3, simDone: false }), "current");
});

test("phases before the active one are 'completed'", () => {
  assert.equal(phaseStepState({ activeIdx: 3, index: 1, simDone: false }), "completed");
});

test("phases after the active one are 'upcoming' (the state the pre-fix stepper never spoke)", () => {
  assert.equal(phaseStepState({ activeIdx: 3, index: 5, simDone: false }), "upcoming");
});

test("when the run is done EVERY phase reads 'completed' — even the one that was active", () => {
  assert.equal(phaseStepState({ activeIdx: 3, index: 3, simDone: true }), "completed");
  assert.equal(phaseStepState({ activeIdx: 3, index: 6, simDone: true }), "completed");
});

test("before any phase is active (activeIdx -1) all phases are 'upcoming'", () => {
  assert.equal(phaseStepState({ activeIdx: -1, index: 0, simDone: false }), "upcoming");
});
