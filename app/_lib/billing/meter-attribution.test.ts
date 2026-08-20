// Three holes in the outcome-priced meter, each of the same shape: the code that
// DECIDES and the code that CHARGES read different tenants, or different limits.
//
//   1. BYOM granted unlimited compute with no check that a customer key exists, so
//      the cheapest paid tier ran unbounded analyses and case designs on OUR keys.
//   2. A voice SIMULATION was gated against the caller's org and debited against the
//      default one, because the session row (entry-less) was stamped default.
//   3. The match-reasoning degrade asked the DEFAULT team's meter whether to fall
//      back to templates, whatever team was asking.
//
// (1) is behavioural here; (2) and (3) are pinned at the source, because both are
// "which argument is passed" contracts in routes the unit runner cannot mount, and
// the behavioural half of (2) lives in the interview-session store test.
//
// unit-db.ts must stay the FIRST project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { byomKeyConfigured, effectiveLimit } from "./entitlements.ts";
import { PLANS } from "./plans.ts";
import { upsertProviderKey } from "../db/llm.ts";

after(() => cleanupUnitDb());

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(path.resolve(HERE, rel), "utf8");

test("without a customer key, BYOM's unlimited compute falls back to the free allowance", () => {
  assert.equal(byomKeyConfigured(), false, "no key entered yet");
  // The two meters BYOM sells as unlimited.
  assert.equal(effectiveLimit(PLANS.byom, "ai_candidates"), PLANS.free.limits.ai_candidates);
  assert.equal(effectiveLimit(PLANS.byom, "case_designs"), PLANS.free.limits.case_designs);
  // …and the two it never did: roles and hires are our product either way.
  assert.equal(effectiveLimit(PLANS.byom, "job_posts"), PLANS.byom.limits.job_posts);
  assert.equal(effectiveLimit(PLANS.byom, "hires"), PLANS.byom.limits.hires);
});

test("a platform key is NOT the customer's key — that substitution is the whole hole", () => {
  upsertProviderKey({ provider: "gemini", scope: "platform", keyCiphertext: "ours" });
  assert.equal(byomKeyConfigured(), false, "a deployment key is ours, not theirs");
  assert.equal(effectiveLimit(PLANS.byom, "ai_candidates"), PLANS.free.limits.ai_candidates);
});

test("pasting a customer key restores unlimited, with no plan change", () => {
  upsertProviderKey({ provider: "gemini", scope: "byom", keyCiphertext: "theirs" });
  assert.equal(byomKeyConfigured(), true);
  assert.equal(effectiveLimit(PLANS.byom, "ai_candidates"), null);
  assert.equal(effectiveLimit(PLANS.byom, "case_designs"), null);
});

test("every other plan is untouched — effectiveLimit is identity outside BYOM", () => {
  for (const plan of [PLANS.free, PLANS.starter, PLANS.growth, PLANS.enterprise]) {
    for (const meter of Object.keys(plan.limits) as (keyof typeof plan.limits)[]) {
      assert.equal(effectiveLimit(plan, meter), plan.limits[meter], `${plan.id}.${meter}`);
    }
  }
});

test("the gate and the debit read ONE limit function, never two", () => {
  const ent = src("./entitlements.ts");
  // meterOverview feeds meterGate/meterAllowance; recordMeterUsage is the debit.
  // Both must resolve through `resolvedLimit`, or the two halves diverge: an
  // unfunded BYOM tier would be refused by the gate and then skip the credit split
  // on the way out, and (since the open-source seam landed) an UNMETERED
  // self-hosted install would gate on nothing while still consuming prepaid
  // credits on the debit side.
  assert.equal(
    (ent.match(/const limit = resolvedLimit\(plan, meter, orgId\)/g) ?? []).length,
    2,
    "meterOverview and recordMeterUsage both resolve the limit through resolvedLimit"
  );
  // resolvedLimit is the ONE place the two layers compose: is this deployment
  // metering this org at all, and then the plan's effective limit.
  assert.match(
    ent,
    /function resolvedLimit[\s\S]*?meteringActive\(orgId\) \? effectiveLimit\(plan, meter\) : null/
  );
  // Nobody reads the raw plan limit directly (effectiveLimit's own body excepted)…
  assert.doesNotMatch(ent.replace(/export function effectiveLimit[\s\S]*?\n}/, ""), /const limit = plan\.limits\[meter\]/);
  // …and nobody bypasses the metering layer by calling effectiveLimit straight.
  assert.doesNotMatch(ent.replace(/function resolvedLimit[\s\S]*?\n}/, ""), /const limit = effectiveLimit\(/);
});

test("a simulation gates and debits the SAME tenant, for the SAME amount", () => {
  const simulate = src("../../api/interview/simulate/route.ts");
  const complete = src("../../api/interview/complete/route.ts");
  // Resolved once, used for both the gate and the session's tenant stamp.
  assert.match(simulate, /const workspace = await currentWorkspace\(\)/);
  // The RESERVATION must be the worst case /complete can debit for this session
  // (maxBillableInterviewMin = bookedMin*2), not the booked length — the same
  // under-reservation /create already closed. Reserving `durationMin` let a demo
  // booked for 8 minutes bill 16 against a meter that only had 8 left.
  assert.match(
    simulate,
    /meterGate\("interview_minutes", \{ minUnits: maxBillableInterviewMin\(durationMin\), workspace \}\)/
  );
  assert.doesNotMatch(simulate, /minUnits: durationMin/);
  assert.match(simulate, /createInterviewSession\(\{\s*\n\s*workspaceId: workspace,/);
  // The debit follows the session row, not a re-derivation that defaults when the
  // session has no entry (which every simulation is).
  assert.match(complete, /recordMeterUsage\("interview_minutes", billedMin, new Date\(\), session\.workspaceId\)/);
  assert.doesNotMatch(complete, /recordMeterUsage\("interview_minutes"[^)]*getEntryWorkspace/);
});

test("the reasoning degrade asks the ASKING team's meter", () => {
  const reasoning = src("../reasoning-run.ts");
  assert.match(reasoning, /meterAllows\("ai_candidates", \{ workspace: workspaceId \}\)/);
  assert.doesNotMatch(reasoning, /meterAllows\("ai_candidates"\)/, "no default-workspace degrade read may remain");
});
