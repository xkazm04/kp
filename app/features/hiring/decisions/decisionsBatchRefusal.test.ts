// remaining-add-callers-read-the-code (wave 19b) — the Decisions queue's bulk
// accept/reject treated a WHOLE-REQUEST refusal as an anonymous transport blip:
// every card stayed selected and the status band said "0 accepted · N couldn't be
// decided" with `reason: null`. The batch door had answered with a CODE and the
// capability it wanted (wave 18a) and the queue read neither — the same defect
// PipelineBulkActionBar fixed one surface over.
//
// Non-vacuity: against pre-fix code every assertion fails — the else branch was two
// lines (a loop adding every target to `failed`) with no body read at all.
//
// Runner: Node's built-in test runner (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const hook = readFileSync(new URL("./useDecisionsQueue.ts", import.meta.url), "utf8");
const bulk = hook.slice(hook.indexOf("const bulkDecideReviews"), hook.indexOf("const groups ="));

test("a whole-request refusal says WHY, resolved from the code", () => {
  assert.match(bulk, /capabilityAwareReason\(/, "the code must be folded, not counted");
  assert.match(bulk, /\{ code: res\.code, capability: res\.capability \}/, "…with the permission the door named");
  assert.match(bulk, /t\("batch\.requestFailed"\)/, "…and a localized fallback when there was no code");
});

test("the whole-request refusal OVERRIDES the per-id reasons", () => {
  assert.match(bulk, /reason: requestReason \?\?/, "no per-id verdict was ever reached when the call itself fell");
});

test("decisions.batch.requestFailed exists in all four catalogs", () => {
  for (const locale of ["en", "cs", "de", "fr"]) {
    const cat = JSON.parse(readFileSync(new URL(`../../../../messages/${locale}.json`, import.meta.url), "utf8")) as {
      decisions: { batch: Record<string, string> };
    };
    assert.ok(cat.decisions.batch.requestFailed, `${locale}: decisions.batch.requestFailed must exist`);
  }
});
