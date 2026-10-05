// A condition is told apart by the mark's SHAPE, never by colour alone: the four states a reader acts
// on wear four different shapes, and "not set up" and "not read" share the dashed ring (their words
// differ; neither is a guess). A need's tone maps onto the same vocabulary.
//
// Runner: Node's built-in test runner with type stripping - npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONDITIONS, CONDITION_MARK, NEED_TONE_CONDITION } from "./conditions.ts";
import { MARK_SHAPES } from "../marks.ts";

test("every condition has a mark with geometry", () => {
  for (const c of CONDITIONS) assert.ok(MARK_SHAPES[CONDITION_MARK[c]].length > 0, c);
});

test("live, wait, reach and fail are four different shapes; off and unknown share the dashed ring", () => {
  const sig = (c: (typeof CONDITIONS)[number]) => JSON.stringify(MARK_SHAPES[CONDITION_MARK[c]]);
  assert.equal(new Set(["live", "wait", "reach", "fail"].map((c) => sig(c as (typeof CONDITIONS)[number]))).size, 4);
  assert.equal(sig("off"), sig("unknown"));
  assert.notEqual(sig("off"), sig("wait"), "not set up is not waiting");
});

test("a need's tone lands on a condition: bad fails, warn reaches, info waits", () => {
  assert.deepEqual(NEED_TONE_CONDITION, { bad: "fail", warn: "reach", info: "wait" });
});
