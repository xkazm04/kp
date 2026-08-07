// bug-ui-scan-2026-07-09 (guided-pipeline-simulation #3): pin the two-step confirm.
// Non-vacuity: the pre-fix control room had NO gate — a single click executed the
// consequential action immediately. The "first click must NOT execute" assertion is
// exactly what a pre-fix (execute-on-first-click) implementation fails; it can't pass
// vacuously because it also asserts the control becomes armed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { armOrExecute } from "./controlRoomConfirm.ts";

test("a first click ARMS the control and does not execute (the misclick guard)", () => {
  const r = armOrExecute(null, "gate-42");
  assert.equal(r.execute, false, "one click must never fire a consequential action");
  assert.equal(r.nextArmed, "gate-42", "the control is now armed, awaiting confirm");
});

test("a second click on the SAME armed control executes and disarms", () => {
  const r = armOrExecute("gate-42", "gate-42");
  assert.equal(r.execute, true);
  assert.equal(r.nextArmed, null, "disarms after firing so it can't double-fire");
});

test("clicking a DIFFERENT control re-arms the new one without executing either", () => {
  const r = armOrExecute("floor", "reconcile");
  assert.equal(r.execute, false, "switching targets never executes the old or new action");
  assert.equal(r.nextArmed, "reconcile");
});
