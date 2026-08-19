// The OPEN-SOURCE seam: a self-hosted install is not metered (billing/mode.ts).
//
// The regression this exists to stop is the one that shipped for months before KP
// went AGPL: `meterGate` ran unconditionally, so an operator running their own copy
// on their own model keys resolved to `PLANS.free` and got a 402 on their SECOND
// published role — pointed at a Billing panel that could sell them nothing. Every
// meter, including the two outcome meters that carry the hosted price (job_posts,
// hires), must read unlimited when nobody is selling anything.
//
// The complementary file is billing-gate.test.ts, which sets POLAR_ACCESS_TOKEN and
// pins the commercial behaviour. Together they pin BOTH sides of the seam — neither
// alone would catch an inversion.
//
//   npm run test:unit   (or: node --import ./scripts/test-alias-loader.mjs \
//                         --experimental-transform-types --test app/_lib/billing-selfhost.test.ts)
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

// Throwaway DB BEFORE importing anything that touches db-path. unit-db.ts also
// scrubs POLAR_* from the environment, which is exactly the state under test here:
// a fresh checkout with no billing provider configured. Nothing sets it back.
const { cleanupUnitDb } = await import("./testing/unit-db.ts");
after(cleanupUnitDb);

const { upsertBillingState } = await import("./db.ts");
const { billingOverview, meterAllowance, meteringActive, recordMeterUsage } = await import("./billing/entitlements.ts");
const { jobPostGate, meterGate } = await import("./billing/enforce.ts");
const { billingProviderConfigured } = await import("./billing/mode.ts");
const { METERS, PLANS } = await import("./billing/plans.ts");

test("no billing provider and no billing history ⇒ this deployment is not metered", () => {
  assert.equal(billingProviderConfigured({} as NodeJS.ProcessEnv), false);
  assert.equal(meteringActive(), false);
});

test("every meter reads unlimited on a self-hosted install — outcome meters included", () => {
  const overview = billingOverview();
  assert.equal(overview.metered, false);
  // Not a subset: ALL of them. The two that carry the hosted price (job_posts,
  // hires) are the ones a partial fix would leave capped at 1.
  assert.deepEqual(
    overview.meters.map((m) => [m.meter, m.limit, m.remaining]),
    METERS.map((meter) => [meter, null, null])
  );
});

test("the gates never refuse: publishing roles and spending past every free allowance", () => {
  // Free grants 1 job post, 1 hire, 25 candidates, 0 interview minutes. Spend well
  // past each one and assert nothing ever produces a verdict.
  const past = (PLANS.free.limits.ai_candidates as number) + 5;
  for (let i = 0; i < past; i++) {
    assert.equal(jobPostGate(), null, `job post ${i + 1} refused`);
    assert.equal(meterGate("ai_candidates"), null, `analysis ${i + 1} refused`);
    recordMeterUsage("job_posts");
    recordMeterUsage("ai_candidates");
  }
  // interview_minutes is 0 on free — the meter most likely to survive a partial fix.
  assert.equal(meterGate("interview_minutes", { minUnits: 120 }), null);
  assert.equal(meterAllowance("interview_minutes").allowed, true);
});

test("usage is still RECORDED while unmetered — the counters stay honest for analytics", () => {
  // Unmetered means "never refused", not "never counted". A self-hoster's own
  // Analytics still needs to know how many analyses ran.
  const before = billingOverview().meters.find((m) => m.meter === "case_designs")!.used;
  recordMeterUsage("case_designs", 3);
  assert.equal(billingOverview().meters.find((m) => m.meter === "case_designs")!.used, before + 3);
});

test("a billing_state row re-engages metering even with the provider credential missing", () => {
  // The belt to the env var's braces: an org that has transacted stays a customer
  // even if POLAR_ACCESS_TOKEN goes missing from a deploy. Without this clause the
  // hosted product's entire revenue gate would rest on one environment variable.
  upsertBillingState({
    orgId: "org_paying",
    plan: "starter",
    status: "active",
    provider: "polar",
    providerCustomerId: "cus_1",
    providerSubscriptionId: "sub_1",
    currentPeriodEnd: new Date(Date.now() + 30 * 86400_000).toISOString(),
  });
  assert.equal(meteringActive("org_paying"), true);
  assert.equal(meteringActive(), false); // the default org is untouched — still self-hosted
});
