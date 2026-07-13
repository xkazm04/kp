import test from "node:test";
import assert from "node:assert/strict";

// bug-ui-scan-2026-07-09 (dev-submissions-live-work-surface #3). Relative import (no
// "@/" alias needed): evalTaskState is an import-free leaf, so type stripping alone
// loads it. This pins the decision the SubmissionRow evaluate control renders from —
// the logic that DIDN'T EXIST pre-fix (the row discarded `error` and treated "failed"
// as "never ran"), so every "failed"/"interrupted"/resultUnavailable assertion below
// is a behavior the old row could not produce.
const { evalTaskView } = await import("./evalTaskState.ts");

test("in-flight statuses are busy and never show an error", () => {
  for (const status of ["queued", "running"] as const) {
    const v = evalTaskView({ status, error: null, resultUnavailable: false });
    assert.equal(v.busy, true);
    assert.equal(v.failed, false);
    assert.equal(v.message, null);
  }
});

test("a failed task surfaces an error chip carrying the hook's error message", () => {
  const v = evalTaskView({ status: "failed", error: "engine timed out", resultUnavailable: false });
  assert.equal(v.busy, false);
  assert.equal(v.failed, true);
  assert.equal(v.message, "Evaluation failed: engine timed out");
});

test("a failed task with no message still shows a generic failure (never silent)", () => {
  const v = evalTaskView({ status: "failed", error: null, resultUnavailable: false });
  assert.equal(v.failed, true);
  assert.equal(v.message, "Evaluation failed.");
});

test("an interrupted task reads as interrupted, not failed", () => {
  const v = evalTaskView({ status: "interrupted", error: "  ", resultUnavailable: false });
  assert.equal(v.failed, true);
  // whitespace-only error is treated as absent
  assert.equal(v.message, "Evaluation was interrupted.");
});

test("resultUnavailable surfaces an error even when the task itself 'succeeded'", () => {
  const v = evalTaskView({ status: "succeeded", error: null, resultUnavailable: true });
  assert.equal(v.busy, false);
  assert.equal(v.failed, true);
  assert.equal(v.message, "Evaluation finished but its result couldn't be loaded.");
});

test("a clean succeeded task shows no error and is not busy", () => {
  const v = evalTaskView({ status: "succeeded", error: null, resultUnavailable: false });
  assert.equal(v.busy, false);
  assert.equal(v.failed, false);
  assert.equal(v.message, null);
});

test("a user cancel is not treated as an error", () => {
  const v = evalTaskView({ status: "canceled", error: null, resultUnavailable: false });
  assert.equal(v.failed, false);
  assert.equal(v.message, null);
});

test("null status (nothing started) is inert", () => {
  const v = evalTaskView({ status: null, error: null, resultUnavailable: false });
  assert.equal(v.busy, false);
  assert.equal(v.failed, false);
  assert.equal(v.message, null);
});
