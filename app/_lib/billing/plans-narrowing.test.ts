// Narrowing a tier that people already pay for is a bulk downgrade, and nothing
// else in the suite can see one.
//
// The catalog in plans.ts is code, so a change to it passes review and ships with
// a deploy. What the deploy does NOT do is ask whether the change reaches existing
// subscribers. On 2026-08-16 (275141050) every sold tier gained two new capped
// meters where it previously had no cap at all (Starter and BYOM went from
// unlimited publishing to 3 job posts a month, Growth to 10), live at deploy time,
// mid-period, with no lifecycle event and no downgrade handler involved. The commit
// read as a pricing redesign, and the three tests that pinned numbers were rewritten
// in the same change to derive from the catalog, so the suite could not see a limit
// move in either direction. Replaying this detector over the catalog's history
// flags exactly that transition (8 caps across 4 tiers) and nothing in the other
// four (the BYOM withdrawal and the ai_candidates raises flag nothing).
//
// The rule (registry: plan-entitlements / live-catalog-edit-is-a-lifecycle-event):
// widening a tier is free. Narrowing one is a choice between two operations:
//   - the change is a NEW OFFER existing subscribers should keep out of: mint a new
//     plan id and mark the old one `legacy` (withdrawn from sale, still honored);
//   - the change really should reach everyone on the tier: update BASELINE below in
//     the same commit, and say in the commit when it takes effect for existing
//     subscribers (a period boundary, not the deploy) and how they are told.
// Either way the decision is written down. What this test refuses is the third
// path, where a pricing change narrows paying customers and nobody decided to.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PLANS } from "./plans.ts";

type Caps = Record<string, number | null>;

/** Caps of every self-serve tier as last acknowledged. null = unlimited. A meter
 *  missing here is unlimited, so a new capped meter on an existing tier is a
 *  narrowing. Contact-sales tiers are per contract and are not listed. */
const BASELINE: Record<string, Caps> = {
  free: { job_posts: 1, hires: 1, ai_candidates: 25, case_designs: 1, interview_minutes: 0 },
  starter: { job_posts: 3, hires: 2, ai_candidates: 300, case_designs: 5, interview_minutes: 30 },
  growth: { job_posts: 10, hires: 8, ai_candidates: 1200, case_designs: 20, interview_minutes: 120 },
  byom: { job_posts: 3, hires: 2, ai_candidates: null, case_designs: null, interview_minutes: 0 },
};

const isNarrower = (now: number | null, was: number | null) => now !== null && (was === null || now < was);

type Tier = { limits: Caps; contactSales?: boolean };

export function narrowings(baseline: Record<string, Caps>, plans: Record<string, Tier>): string[] {
  const found: string[] = [];
  for (const [id, was] of Object.entries(baseline)) {
    const plan = plans[id];
    if (!plan || plan.contactSales) continue; // a removed id is a different failure, and plans.ts forbids it
    for (const [meter, now] of Object.entries(plan.limits)) {
      const before = meter in was ? was[meter] : null;
      if (isNarrower(now, before)) found.push(`${id}.${meter}: ${before ?? "unlimited"} -> ${now}`);
    }
  }
  return found;
}

test("the detector sees a narrowing, including a cap where there was none", () => {
  assert.deepEqual(narrowings({ t: { a: 5 } }, { t: { limits: { a: 3 } } }), ["t.a: 5 -> 3"]);
  assert.deepEqual(narrowings({ t: { a: null } }, { t: { limits: { a: 3 } } }), ["t.a: unlimited -> 3"]);
  assert.deepEqual(narrowings({ t: {} }, { t: { limits: { a: 3 } } }), ["t.a: unlimited -> 3"]);
});

test("the detector ignores widening and contact-sales tiers", () => {
  assert.deepEqual(narrowings({ t: { a: 3 } }, { t: { limits: { a: 5 } } }), []);
  assert.deepEqual(narrowings({ t: { a: 3 } }, { t: { limits: { a: null } } }), []);
  assert.deepEqual(narrowings({ t: { a: null } }, { t: { limits: { a: 1 }, contactSales: true } }), []);
});

test("no self-serve tier is narrower than its acknowledged baseline", () => {
  const found = narrowings(BASELINE, PLANS);
  assert.deepEqual(
    found,
    [],
    `plans.ts narrows a tier people may already pay for:\n  ${found.join("\n  ")}\n` +
      "Either mint a new plan id and mark the old one legacy, or update BASELINE in " +
      "plans-narrowing.test.ts and state in the commit when existing subscribers get the change.",
  );
});

test("every self-serve tier has a baseline, so a new tier is acknowledged when it ships", () => {
  const missing = Object.values(PLANS).filter((p) => !p.contactSales && !(p.id in BASELINE)).map((p) => p.id);
  assert.deepEqual(missing, []);
});
