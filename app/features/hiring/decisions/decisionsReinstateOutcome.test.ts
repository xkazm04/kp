// Pins the reinstate fold: a failed reinstate is never silent.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyReinstateOutcome,
  foldReinstateResponse,
  type ReinstateFailure,
} from "./decisionsReinstateOutcome.ts";

const rows = [{ id: "a" }, { id: "b" }];

test("a 2xx reinstate is a removal", () => {
  const out = foldReinstateResponse("a", { ok: true, status: 200 }, { entry: {} });
  assert.deepEqual(out, { ok: true, id: "a" });
  const next = applyReinstateOutcome(rows, {}, out);
  assert.deepEqual(next.rows.map((r) => r.id), ["b"]);
  assert.deepEqual(next.failures, {});
});

test("a refused reinstate keeps the row and its { code, status }", () => {
  const out = foldReinstateResponse("a", { ok: false, status: 409 }, {
    error: "There is no auto-rejection to reverse here.",
    code: "PIPELINE_NOT_REINSTATABLE",
  });
  assert.deepEqual(out, { ok: false, id: "a", failure: { code: "PIPELINE_NOT_REINSTATABLE", status: 409 } });
  const next = applyReinstateOutcome(rows, {}, out);
  assert.deepEqual(next.rows.map((r) => r.id), ["a", "b"], "a failure never removes the row");
  assert.equal(next.failures.a?.code, "PIPELINE_NOT_REINSTATABLE");
});

test("a response with no machine code still reports the status", () => {
  const out = foldReinstateResponse("b", { ok: false, status: 500 }, { error: "boom" });
  assert.deepEqual(out, { ok: false, id: "b", failure: { code: null, status: 500 } });
});

test("a request that never landed folds to a failure, not a throw", () => {
  const out = foldReinstateResponse("b", null, null);
  assert.deepEqual(out, { ok: false, id: "b", failure: { code: null, status: null } });
});

test("a later success clears the row's stale failure line", () => {
  const failures: Record<string, ReinstateFailure> = { a: { code: "PIPELINE_ACTION_FAILED", status: 500 } };
  const next = applyReinstateOutcome(rows, failures, foldReinstateResponse("a", { ok: true, status: 200 }, {}));
  assert.deepEqual(next.failures, {}, "retrying successfully must not leave the old error on screen");
  assert.deepEqual(failures, { a: { code: "PIPELINE_ACTION_FAILED", status: 500 } }, "input is not mutated");
});

test("failures for other rows survive one row's outcome", () => {
  const failures: Record<string, ReinstateFailure> = { b: { code: null, status: null } };
  const next = applyReinstateOutcome(rows, failures, foldReinstateResponse("a", { ok: false, status: 409 }, { code: "X" }));
  assert.deepEqual(Object.keys(next.failures).sort(), ["a", "b"]);
});
