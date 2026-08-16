// Reserve/gate seam (bug-ui-scan 2026-07-09 findings A & B). The class of bug: the
// amount a meter GATES is less than the amount later DEBITED, or the gate is checked
// without reserving so concurrency exceeds the cap. This pins the two fixes end-to-end
// against the REAL billing stack (db barrel + entitlements math) on a throwaway SQLite
// file — same harness as billing-gate.test.ts.
//
//   npm run test:unit   (or: node --import ./scripts/test-alias-loader.mjs \
//                         --experimental-transform-types --test app/_lib/billing-reserve.test.ts)
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

// Same minimal resolve hook as billing-gate.test.ts (extensionless TS siblings +
// "@/" alias) so this file loads even when run without the package.json --import loader.
const ROOT = new URL("../../", import.meta.url).href; // repo root (app/_lib/ -> ../../)
registerHooks({
  resolve(specifier, context, nextResolve) {
    let spec = specifier;
    const fromOurCode = context.parentURL && !context.parentURL.includes("node_modules");
    if (spec.startsWith("@/")) spec = new URL(spec.slice(2), ROOT).href;
    else if ((spec.startsWith("./") || spec.startsWith("../")) && fromOurCode) {
      spec = new URL(spec, context.parentURL!).href;
    }
    if (spec.startsWith("file:") && !/\.[a-z0-9]+$/i.test(spec) && fs.existsSync(fileURLToPath(spec + ".ts"))) {
      spec += ".ts";
    }
    return nextResolve(spec, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".json")) {
      const source = "export default " + fs.readFileSync(fileURLToPath(url), "utf8") + ";";
      return { format: "module", source, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

// Throwaway DB BEFORE importing anything that touches db-path (DB_PATH is frozen from
// KP_DB_PATH at module-eval time), so this MUST stay the first project import. Same
// pid-recycling defect as billing-gate.test.ts: the old
// `kp-billing-reserve-test-${process.pid}.sqlite` was never deleted, so a run that drew a
// previously-used pid re-opened that run's leftover DB — spendTo() then saw usage already
// past the target and its `need >= 0` precondition blew up. unit-db.ts mkdtemps a unique
// run directory instead (never pid-derived) and sweeps/cleans up after itself.
const { cleanupUnitDb } = await import("./testing/unit-db.ts");
after(cleanupUnitDb);

const { upsertBillingState, billingUsageFor } = await import("./db.ts");
const { recordMeterUsage } = await import("./billing/entitlements.ts");
const { meterGate, maxBillableInterviewMin } = await import("./billing/enforce.ts");
const { PLANS, currentPeriod } = await import("./billing/plans.ts");
const { upsertProviderKey, deleteProviderKey } = await import("./db/llm.ts");

import type { Meter, PlanId } from "./billing/plans.ts";

// Kept as a literal (matches interview-duration.mjs GROUNDED_DEFAULT_MIN) so the test
// doesn't have to load the .mjs under the bare runner — it's the pre-fix gate value.
const GROUNDED_DEFAULT_MIN = 20;

// Put the workspace on `plan` and spend included allowance until exactly
// `targetRemaining` units are left (no credits in these tests). Reads current usage, so
// it's order-independent as long as the target is <= what currently remains.
function spendTo(meter: Meter, plan: PlanId, targetRemaining: number): void {
  upsertBillingState({
    plan,
    status: plan === "free" ? "none" : "active",
    provider: "polar",
    currentPeriodEnd: "2999-12-31T00:00:00Z",
  });
  const limit = PLANS[plan].limits[meter];
  assert.equal(typeof limit, "number", "spendTo needs a limited meter");
  const used = billingUsageFor(meter, currentPeriod());
  const need = (limit as number) - used - targetRemaining;
  assert.ok(need >= 0, `target ${targetRemaining} unreachable (used ${used}, limit ${limit})`);
  if (need > 0) recordMeterUsage(meter, need);
}

// ---- Finding A: the gate must RESERVE the worst-case debit, not a constant ---------

test("maxBillableInterviewMin equals the /complete debit ceiling (bookedMin * 2)", () => {
  // If this helper is reverted to return the 1× booked length, the *2 assertions fail —
  // and so does the gate below — which is the non-vacuity proof for finding A.
  assert.equal(maxBillableInterviewMin(20), 40);
  assert.equal(maxBillableInterviewMin(30), 60);
  assert.equal(maxBillableInterviewMin(5), 10);
});

test("near-cap interview meter refuses a run whose worst-case debit exceeds remaining", () => {
  // Starter includes 30 interview minutes; leave exactly 20 remaining.
  spendTo("interview_minutes", "starter", 20);

  // A booked 20-min call can debit up to 40 at /complete (2×). Reserving that worst
  // case, 20 remaining is NOT enough → the create gate must 402.
  assert.equal(
    meterGate("interview_minutes", { minUnits: maxBillableInterviewMin(20) })?.code,
    "quota_exceeded"
  );

  // NON-VACUITY: the pre-fix create route reserved only the 20-min constant, which
  // WRONGLY passes here (remaining 20 >= 20) — the exact under-reservation the fix
  // closes. Run against pre-fix code, the fix's gate would return null like this line.
  assert.equal(meterGate("interview_minutes", { minUnits: GROUNDED_DEFAULT_MIN }), null);

  // A shorter booking the meter CAN actually cover still proceeds: a 10-min call bills
  // at most 20 (2×), which fits the 20 remaining exactly.
  assert.equal(meterGate("interview_minutes", { minUnits: maxBillableInterviewMin(10) }), null);
});

// ---- Finding B: the gate must see in-flight, not-yet-debited work -------------------

test("one in-flight analyze reservation blocks the last unit (no gate/debit divergence)", () => {
  // Free plan ai_candidates limit 5; leave exactly 1 unit.
  spendTo("ai_candidates", "free", 1);

  // First concurrent submit: nothing in flight → allowed (it reserves the last unit).
  assert.equal(meterGate("ai_candidates", { inFlight: 0 }), null);

  // The SECOND concurrent submit, with that run already queued/running (reserved but not
  // yet debited): remaining(1) − inFlight(1) = 0 < 1 → refused.
  // NON-VACUITY: pre-fix meterGate has no `inFlight` param and ignores it, so this same
  // call returned null (the burst overrun) — this assertion fails against pre-fix code.
  assert.equal(meterGate("ai_candidates", { inFlight: 1 })?.code, "quota_exceeded");
});

test("N concurrent analyze submits: exactly `remaining` pass, the next is refused", () => {
  // Starter ai_candidates limit 100; leave exactly 3 units. (Switching to the larger
  // limit keeps this reachable after the free-plan spend above.)
  spendTo("ai_candidates", "starter", 3);

  // Model N concurrent submits: the k-th sees (k−1) predecessors already reserved in the
  // same synchronous tick (their task rows). Only k <= remaining may collectively pass.
  assert.equal(meterGate("ai_candidates", { inFlight: 0 }), null); // submit 1
  assert.equal(meterGate("ai_candidates", { inFlight: 1 }), null); // submit 2
  assert.equal(meterGate("ai_candidates", { inFlight: 2 }), null); // submit 3
  // The 4th would push the collective total to 4 against a cap of 3 → refused.
  assert.equal(meterGate("ai_candidates", { inFlight: 3 })?.code, "quota_exceeded");
});

test("an unlimited (null) meter proceeds regardless of in-flight or worst-case reserve", () => {
  // BYOM: ai_candidates unlimited — but only ON THE CUSTOMER'S OWN KEY, which is what
  // the tier sells. The key has to exist for the grant to apply (effectiveLimit); an
  // unfunded BYOM subscription is metered like the free tier, see below.
  upsertBillingState({ plan: "byom", status: "active", provider: "polar", currentPeriodEnd: "2999-12-31T00:00:00Z" });
  upsertProviderKey({ provider: "gemini", scope: "byom", keyCiphertext: "customer-key" });
  assert.equal(meterGate("ai_candidates", { inFlight: 1000 }), null);
  assert.equal(meterGate("ai_candidates", { minUnits: maxBillableInterviewMin(30), inFlight: 5 }), null);
});

test("BYOM without a customer key is NOT unlimited — the grant is on their key, not ours", () => {
  // The hole this closes: the cheapest paid tier resolved `null` against OUR provider
  // keys, so a subscriber who never pasted one ran unbounded analyses on our spend.
  upsertBillingState({ plan: "byom", status: "active", provider: "polar", currentPeriodEnd: "2999-12-31T00:00:00Z" });
  deleteProviderKey("gemini", "byom");
  const verdict = meterGate("ai_candidates", { inFlight: 1000 });
  assert.ok(verdict, "an unfunded BYOM tier is metered");
  assert.equal(verdict.meter, "ai_candidates");
  assert.equal(verdict.plan, "byom", "the plan is unchanged — only the allowance falls back");
});
