// The redesign route must RE-CHECK the review gate after its design call, not just before
// it (a check-then-act across an await — the same defect class the close route's
// claimLifecycleClose fixed, see ../close/route.test.ts).
//
// `runDesignArtifacts` is a spawned LLM design pass with `maxDuration = 60`, and the only
// gate check sits BEFORE it. Interleaving: reviewer A clicks "Regenerate with note";
// while that runs, a second tab / a second reviewer on the shared control-room gate queue
// clicks Approve — which freezes `lc.case` into dev_cases and publishes it. The redesign
// then returns and writes the NEWER role+case over the lifecycle with
// detail "redesigned with reviewer feedback — awaiting approval". The studio now renders
// a case no candidate was ever given, under a detail claiming it still awaits review,
// while the apply link serves the approved one.
//
// The route spawns Python, so it cannot be driven in a unit test — this pins the guard at
// the source, exactly as ../approve/approve-gate.test.ts does for its sibling defect.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "route.ts"), "utf8");

test("the regenerated design is only written while the lifecycle is STILL at the review gate", () => {
  const designAt = src.indexOf("await runDesignArtifacts(");
  assert.ok(designAt >= 0, "expected the design call this guard exists around");

  // A re-read of the lifecycle AFTER the design await — the pre-check's `lc` is stale by then.
  const recheckAt = src.indexOf("getLifecycle(id)", designAt);
  assert.ok(recheckAt > designAt, "the lifecycle must be re-read after the design call, not only before it");

  // …guarded by the same review-gate predicate as the pre-check…
  const gateAt = src.indexOf("isAtReviewGate(", recheckAt);
  assert.ok(gateAt > recheckAt, "the re-read must be tested with isAtReviewGate");

  // …refusing with 409 + the current stage (the approve route's off-gate convention)…
  const refusal = src.slice(gateAt, gateAt + 700);
  assert.match(refusal, /status:\s*409/, "an off-gate redesign must 409, not overwrite");
  assert.match(refusal, /stage:/, "the 409 body must carry the current stage so the UI can say 'approved elsewhere'");

  // …BEFORE the write. A write that precedes the re-check is the bug itself.
  const writeAt = src.indexOf("updateLifecycle(id,", designAt);
  assert.ok(writeAt > gateAt, "updateLifecycle must run only after the gate re-check");
});
