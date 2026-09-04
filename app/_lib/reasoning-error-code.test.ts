// The reasoning failure vocabulary keeps the code the RUNNER already produced.
//
// python-runner.ts::parseStderrError derives a machine `code` ("not_found" /
// "invalid_input" / "engine_error") alongside message+status, and reasoning-run.ts
// threw it away — ReasoningError carried message+status only, so /api/match/reasoning
// re-derived a code from the HTTP status and answered "the candidate or role behind
// it is gone" for a malformed request that named no candidate at all. Two different
// remedies (refresh the grid vs fix the request) wore one sentence.
//
// These pin the plumbing end to end: every throw site stamps a code, and the route
// forwards it instead of re-deriving.
//
// testing/unit-db.ts MUST be the first project import — reasoning-run.ts pulls the
// db barrel at module top.
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ReasoningError, runReasoning } from "./reasoning-run.ts";

after(() => cleanupUnitDb());

const dir = path.dirname(fileURLToPath(import.meta.url));

test("ReasoningError carries the runner's machine code alongside message + status", () => {
  const err = new ReasoningError("boom", 404, "not_found");
  assert.equal(err.status, 404);
  assert.equal(err.code, "not_found");
  assert.equal(err.message, "boom");
});

test("a missing jobId is invalid_input, not a vanished pair", async () => {
  await assert.rejects(
    () => runReasoning({ profileId: "p-1" } as never),
    (e: unknown) => {
      assert.ok(e instanceof ReasoningError);
      assert.equal(e.status, 400);
      assert.equal(e.code, "invalid_input", "a request that names no job is malformed input");
      return true;
    }
  );
});

test("an unresolvable candidate is not_found — distinguishable from invalid_input", async () => {
  await assert.rejects(
    () => runReasoning({ jobId: "job-1", profileId: "profile-that-does-not-exist" } as never),
    (e: unknown) => {
      assert.ok(e instanceof ReasoningError);
      assert.equal(e.status, 404);
      assert.equal(e.code, "not_found", "a resolved-but-absent profile is a not_found, not a bad request");
      return true;
    }
  );
});

// The route is not unit-loadable (it needs a Next request scope), so its half of the
// contract is a source guard — the kp convention for route handlers.
test("the reasoning route forwards the error's code instead of re-deriving from status", () => {
  const src = readFileSync(path.join(dir, "../api/match/reasoning/route.ts"), "utf8");
  assert.match(
    src,
    /matrixEngineAnswer\(\s*\{[^}]*code:\s*error\.code/,
    "the runner's code must reach matrixEngineAnswer, not just the status"
  );
  assert.match(
    src,
    /REASONING_RUNNER_REFUSALS/,
    "not_found and invalid_input must map through a DECLARED table, never a blind index into REFUSAL_ERRORS"
  );
  assert.match(src, /not_found:\s*"MATCH_REASONING_UNAVAILABLE"/);
  assert.match(src, /invalid_input:\s*"MATCH_REASONING_INPUT_INVALID"/);
});
