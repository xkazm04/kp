// The cumulative stage ladder every About scene's choreography is expressed in.
// It is the deck's smallest load-bearing rule — "a module is never shown or
// hidden, it is AT a stage, and the stages only go forwards" — and every scene
// reads as intended only while `stageOf` agrees with the table its author wrote.
//
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import { atStage, rectStyle, r2, stageOf, stepDelay, STEP, type StagePlan } from "./stages.ts";

const PLAN: StagePlan = { shell: 1, body: 3, detail: 5, chosen: 8 };

test("a plan's beats map to the stage the author scheduled", () => {
  assert.equal(stageOf(PLAN, 0), "ghost", "before its first beat a module is an outline holding space");
  assert.equal(stageOf(PLAN, 1), "shell");
  assert.equal(stageOf(PLAN, 2), "shell", "a stage holds until the next beat — it is not a one-frame event");
  assert.equal(stageOf(PLAN, 3), "body");
  assert.equal(stageOf(PLAN, 5), "detail");
  assert.equal(stageOf(PLAN, 8), "chosen");
  assert.equal(stageOf(PLAN, 40), "chosen", "the last stage holds for the rest of the loop");
});

test("scenery with no commit beat never reaches `chosen`", () => {
  // `chosen: null` is the honest half of several scenes: the candidate who is
  // not advanced, the draft that is not sent, the requirement that is dropped.
  // If a null plan could ever land on `chosen`, those scenes would quietly
  // start claiming the opposite of what they were built to show.
  const scenery: StagePlan = { shell: 1, body: 2, detail: 3, chosen: null };
  for (const phase of [0, 1, 2, 3, 10, 99]) {
    assert.notEqual(stageOf(scenery, phase), "chosen", `phase ${phase} promoted scenery to chosen`);
  }
  assert.equal(stageOf(scenery, 99), "detail");
});

test("a plan whose beats are out of order still resolves highest-first", () => {
  // Not a supported way to author a scene, but `stageOf` tests in descending
  // rank, so it must not depend on the beats ascending. A scene mid-retime
  // should render a legible frame rather than an impossible one.
  const jumbled: StagePlan = { shell: 6, body: 4, detail: 2, chosen: null };
  assert.equal(stageOf(jumbled, 3), "detail", "the highest stage whose beat has passed wins");
  assert.equal(stageOf(jumbled, 1), "ghost");
});

test("atStage is a floor, so a part drawn at `body` stays drawn at `chosen`", () => {
  // Every dumb part in the deck asks this question and nothing else. If it were
  // an equality test, each part would flicker out the moment its module moved
  // on to the next stage.
  assert.equal(atStage("chosen", "body"), true);
  assert.equal(atStage("body", "body"), true);
  assert.equal(atStage("shell", "body"), false);
  assert.equal(atStage("ghost", "ghost"), true);
});

test("the sub-beat cascade stays inside one beat", () => {
  // One tick is ~900ms and STEP is the per-index lead. Eight parts is the
  // documented ceiling; past ~0.12 * 8 the group stops reading as one gesture
  // and starts reading as a list loading.
  assert.equal(stepDelay(0), 0);
  assert.equal(r2(stepDelay(3)), r2(3 * STEP));
  assert.equal(r2(stepDelay(2, 0.5)), r2(0.5 + 2 * STEP), "a lead offsets the whole cascade");
  assert.ok(stepDelay(7) < 0.9, "eight parts must still land inside their own 900ms beat");
});

test("percent rects render as percent CSS, so a thread anchor and a box agree", () => {
  // The unlocked viewBox means a number here and a CSS percent are the same
  // place. That is the only reason a connector can be guaranteed not to point
  // at empty space.
  assert.deepEqual(rectStyle({ x: 12.5, y: 0, w: 40, h: 17 }), {
    left: "12.5%",
    top: "0%",
    width: "40%",
    height: "17%",
  });
});

test("r2 rounds to two places and keeps generated paths diff-stable", () => {
  assert.equal(r2(1 / 3), 0.33);
  assert.equal(r2(0.126), 0.13);
  assert.equal(r2(-1.239), -1.24);
  assert.equal(r2(5), 5, "a whole number must not gain a decimal tail");
});
