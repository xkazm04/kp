// Pins the single-flight BOOKKEEPING contract of POST /api/automation/run.
//
// The defect: `joined = isPassInFlight()` was read BEFORE `await currentWorkspace()`
// (which awaits cookies() + connection(), real event-loop yields), so two
// near-simultaneous POSTs — a double-click, or the board button racing an external
// cron — BOTH observed "no pass in flight", both continued, the first started the
// pass and the second JOINED it via runAutomationPass's single-flight… and both
// wrote a scheduler_runs row. One executed pass, two identical run-history entries
// (and `last_summary_json` written twice) — the run log claiming work that never
// happened twice, which is exactly the success-theater `evaluated` exists to prevent.
//
// scheduler.ts states the invariant explicitly ("captured synchronously before the
// call (no await between, so it's accurate)") and honors it; the route drifted from
// it. Pinned here as source structure because the race is an interleaving, not a
// value: the ONLY thing that makes the check accurate is that nothing suspends
// between it and the call that sets the in-flight slot.
//
// Runner: Node's built-in test runner (no deps, no Next runtime needed).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "route.ts"), "utf8");

test("THE FIX: nothing awaits between the in-flight check and the pass call", () => {
  const checkAt = src.indexOf("isPassInFlight()");
  const callAt = src.indexOf("runAutomationPass(");
  assert.ok(checkAt > 0, "the route must still consult isPassInFlight()");
  assert.ok(callAt > checkAt, "the check must come before the pass call");
  // The `await` OPERATOR on the call itself is not a gap: `await runAutomationPass(…)`
  // evaluates its operand — which fills the single-flight slot — before suspending.
  const between = src.slice(checkAt, callAt).replace(/await\s*$/, "");
  assert.ok(
    !/\bawait\b/.test(between),
    `an await between the check and the call reopens the double-record race:\n${between.trim()}`
  );
});

test("the run log is still written only by the caller that STARTED the pass", () => {
  // Non-vacuity: the test above passes trivially if the guard were deleted, which
  // would make EVERY joined caller record a duplicate run.
  const guards = src.match(/!dryRun && !joined/g) ?? [];
  assert.equal(guards.length, 2, "both the ok and the error recordRun must be gated on !joined");
});
