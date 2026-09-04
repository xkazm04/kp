// The TIMEOUT branch of the stage deadlines (the companion to
// group-eval-deadline.test.ts, which covers the helper and the failure branch).
//
// A stage that passes its deadline must be disclosed as a `timeout`, not folded
// into a generic `failed`: the two ask an operator for different things — a failure
// is a broken interpreter or a bad prompt, a timeout is a provider that needs a
// longer `KP_GROUP_EVAL_STAGE_TIMEOUT_MS` or a smaller cohort.
//
// This file exists SEPARATELY because the override is read once at module load, so
// it has to be set before group-eval-run is imported — and the unit runner gives
// each file its own process.
//
// Run: npm run test:unit
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";

// 1ms for every stage: whatever the spawn would have done, the deadline is already
// past when the result is inspected. No interpreter, provider or network involved.
process.env.KP_GROUP_EVAL_STAGE_TIMEOUT_MS = "1";
process.env.PYTHON_CMD = "kp-no-python-for-this-test";
const { runGroupEval } = await import("./group-eval-run.ts");

after(() => cleanupUnitDb());

const candidate = (entryId: string, matchScore: number) => ({ entryId, candidateId: null, label: entryId, matchScore });

test("a stage that passes its deadline is disclosed as a timeout, and the result still lands", async () => {
  const res = await runGroupEval({
    roleKey: "role-timeout",
    roleTitle: "Backend Engineer",
    candidates: [candidate("to-a", 90), candidate("to-b", 40)],
    governanceMode: "recommendation",
  });

  const stages = res.degradedStages as { stage: string; reason: string }[] | null;
  assert.ok(stages, "a timed-out narrative must not read as a full AI comparison");
  const comparison = stages.find((s) => s.stage === "comparison");
  assert.ok(comparison, `the comparison stage must be disclosed, got ${JSON.stringify(stages)}`);
  assert.equal(comparison.reason, "timeout", "our own deadline firing is a timeout, distinct from a failed spawn");

  // The deadline degrades, it does not abort: the deterministic evaluation is still
  // produced and still crowns a lead. That is the property that makes a deadline
  // safe to state at all — passing it costs fidelity, never the result.
  assert.equal(res.comparison, null, "the AI narrative is genuinely absent");
  assert.ok(res.summary, "the deterministic summary still stands in for it");
  assert.equal((res.topPick as { entryId?: string }).entryId, "to-a", "and the field is still ranked");
});
