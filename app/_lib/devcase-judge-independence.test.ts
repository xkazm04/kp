// ONE THREAD (gap 5) — what the integrity strip says about the judge seat.
//
// The rendering rule is deliberately ASYMMETRIC, and the asymmetry is the whole point:
// only the self-grading state is shown. A green "judge independent" chip beside a
// submission's scores would claim a check this bundle never had — the judge seat runs in
// the calibration and lifecycle harnesses, not on the runtime evaluation — and "absent"
// covers two different unknowns (a bundle saved before the field existed, and a keyless
// deterministic run that had no generating model for a judge to be independent OF).
//
// These pin that rule as a value, because this repo has no component-test harness: every
// test here is node:test over `.ts`, so the DECISION lives in a pure module and the
// component is left as wiring. `DevEvalPanel.tsx` opens the strip on exactly the state
// asserted below, and `DevEvalPanelIntegrity.tsx` renders exactly one Fact for it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { judgeSeatState, normalizeJudgeIndependence } from "./devcase-judge-independence.ts";

const SELF_GRADING = { generator: "claude_cli/opus", judge: "claude_cli/opus", independent: false };
const INDEPENDENT = { generator: "claude_cli/default", judge: "claude_cli/haiku", independent: true };

test("a self-grading install is the one state the panel shows", () => {
  assert.equal(judgeSeatState(SELF_GRADING), "self_grading");
});

test("an independent seat renders NOTHING — the runtime evaluation was not itself judged", () => {
  assert.equal(judgeSeatState(INDEPENDENT), "independent");
});

test("a bundle from before the field existed claims nothing in either direction", () => {
  // The regression that matters most: an evaluation saved months ago must not start
  // reading as a self-graded one just because the field it never carried is missing.
  assert.equal(judgeSeatState(undefined), "absent");
  assert.equal(judgeSeatState(null), "absent");
  assert.equal(judgeSeatState({}), "absent");
});

test("a malformed or half-written blob is absent, never an accusation and never a pass", () => {
  // The eval bundle crosses the Python/TS seam as free-form JSON — there is no codegen'd
  // schema behind it — so every one of these is reachable from a legacy row, a partial
  // emit, or a hand-edited blob.
  for (const raw of [
    "self_grading",
    42,
    [SELF_GRADING],
    { independent: false }, // no seat identities
    { independent: "false", generator: "a", judge: "b" }, // string, not boolean
    { independent: false, generator: "  ", judge: "claude_cli/opus" }, // blank identity
    { generator: "claude_cli/opus", judge: "claude_cli/opus" }, // verdict missing
  ]) {
    assert.equal(judgeSeatState(raw), "absent", `${JSON.stringify(raw)} must not render a verdict`);
  }
});

test("the normalizer trims and preserves both seat identities", () => {
  assert.deepEqual(normalizeJudgeIndependence({ generator: " anthropic/claude-haiku-4-5 ", judge: "anthropic/claude-sonnet-4-6", independent: true }), {
    generator: "anthropic/claude-haiku-4-5",
    judge: "anthropic/claude-sonnet-4-6",
    independent: true,
  });
  assert.equal(normalizeJudgeIndependence(SELF_GRADING)?.independent, false);
});
