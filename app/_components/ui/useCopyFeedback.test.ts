/*
 * The copy-confirmation rule, on the pure half of useCopyFeedback.
 *
 * The hook's React half (a ref'd timer cleared on unmount) needs a renderer;
 * the RULE it enforces does not — and the rule is the part that was wrong at
 * all four call sites this hook replaces: three of them confirmed on the
 * outcome, one confirmed unconditionally, and none of them said so anywhere a
 * test could read.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { COPY_FEEDBACK_MS, copyFeedbackPlan } from "./useCopyFeedback.ts";

test("a successful copy confirms and arms the reset", () => {
  assert.deepEqual(copyFeedbackPlan(true, COPY_FEEDBACK_MS), { copied: true, resetAfterMs: COPY_FEEDBACK_MS });
});

test("a failed copy never shows a confirmation, and arms nothing", () => {
  // The blocked-clipboard case: copyText returned false, so there is nothing to
  // confirm and nothing to time out of.
  assert.deepEqual(copyFeedbackPlan(false, COPY_FEEDBACK_MS), { copied: false, resetAfterMs: null });
});

test("a non-positive window confirms without arming a timer that would fire immediately", () => {
  assert.deepEqual(copyFeedbackPlan(true, 0), { copied: true, resetAfterMs: null });
  assert.deepEqual(copyFeedbackPlan(true, -1), { copied: true, resetAfterMs: null });
});

test("the shared window is the two seconds every site had hand-typed", () => {
  assert.equal(COPY_FEEDBACK_MS, 2000);
});
