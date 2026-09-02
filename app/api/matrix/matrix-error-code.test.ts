// matrix-answers-with-codes-and-retries (a). The two matrix routes both dropped the
// machine code the Python runner already produces, so every failure on the grid and on
// the reasoning popover rendered as the generic "couldn't load" — including the 429,
// where the recruiter is never told to simply wait.
import { test } from "node:test";
import assert from "node:assert/strict";
import { matrixEngineAnswer, MATRIX_GRID_SURFACE, MATRIX_REASONING_SURFACE } from "./matrix-error-code.ts";

test("a 429 is a rate-limit refusal, whatever the runner called it", () => {
  assert.deepEqual(matrixEngineAnswer({ status: 429 }, MATRIX_GRID_SURFACE), { kind: "refusal", code: "TOO_MANY_REQUESTS" });
  assert.deepEqual(matrixEngineAnswer({ status: 429, code: "engine_error" }, MATRIX_REASONING_SURFACE), {
    kind: "refusal",
    code: "TOO_MANY_REQUESTS",
  });
});

test("a runner code that names a registered refusal is forwarded as that refusal", () => {
  assert.deepEqual(matrixEngineAnswer({ status: 500, code: "rate_limited" }, MATRIX_GRID_SURFACE), {
    kind: "refusal",
    code: "TOO_MANY_REQUESTS",
  });
});

test("a 4xx the runner did not name becomes the surface's own refusal code", () => {
  assert.deepEqual(matrixEngineAnswer({ status: 400, code: "invalid_input" }, MATRIX_GRID_SURFACE), {
    kind: "refusal",
    code: "MATRIX_INPUT_INVALID",
  });
  assert.deepEqual(matrixEngineAnswer({ status: 404, code: "not_found" }, MATRIX_REASONING_SURFACE), {
    kind: "refusal",
    code: "MATCH_REASONING_UNAVAILABLE",
  });
});

test("a 5xx is a STORE error — logged server-side, generic on the wire", () => {
  // The thrown message here carries a Python traceback and the temp workdir path;
  // that is exactly what safeJsonError exists to keep off the wire.
  assert.deepEqual(matrixEngineAnswer({ status: 500, code: "engine_error" }, MATRIX_GRID_SURFACE), {
    kind: "store",
    code: "MATRIX_BUILD_FAILED",
  });
  assert.deepEqual(matrixEngineAnswer({ status: 503 }, MATRIX_REASONING_SURFACE), {
    kind: "store",
    code: "MATCH_REASONING_FAILED",
  });
});

test("the two surfaces never share a code — the grid and the popover fail differently", () => {
  assert.notEqual(MATRIX_GRID_SURFACE.invalid, MATRIX_REASONING_SURFACE.invalid);
  assert.notEqual(MATRIX_GRID_SURFACE.failed, MATRIX_REASONING_SURFACE.failed);
});
