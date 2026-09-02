// THE `job_posts` DEBIT FIRES ONCE PER JOB EVER — reopening a closed role is free.
//
// That rule was written down in three places and implemented in none:
//
//   app/api/jobs/[id]/publish/route.ts   "this fires once per job EVER — closing and
//                                         reopening a role never re-charges"
//   app/_lib/billing/enforce.ts          "The debit is once per job EVER, not per
//                                         publish … closing and reopening a role does
//                                         not charge again"
//
// Both justified the rule with `setJobStatus`'s `published_at = COALESCE(published_at, ?)`.
// That stamp guards the TIMESTAMP and nothing else — it never reaches `jobPostGate` or
// `recordMeterUsage`. The route skipped the gate and the debit only when the row was
// ALREADY `published`, so the one transition the comment named — closed → published —
// took the gate and paid the meter every single time. A team that closes a filled role
// and reopens it a month later was charged twice for one opening, and on the free plan
// the SECOND reopen could be refused 402 for a role the customer had already paid for.
//
// This drives the route's transaction body against the real billing + job modules on a
// throwaway DB, exactly as publish-atomicity.test.ts does (the handler itself sits
// behind cookie auth and cannot be called from the unit runner). The decision now lives
// in ONE place — `classifyPublish` in job-ingest.ts — so this test pins the rule the
// route reads, not a copy of it.
//   npm run test:unit
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../../../", import.meta.url).href; // repo root (app/api/jobs/ -> ../../../)
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

// Throwaway DB BEFORE any db-path import (see unit-db.ts) — must stay the first
// project import.
const { cleanupUnitDb } = await import("../../_lib/testing/unit-db.ts");
after(cleanupUnitDb);

// Metered (hosted) mode: the self-hosted install has no LIMIT, but `recordMeterUsage`
// writes the usage row either way, so the double-charge below is visible in both.
process.env.POLAR_ACCESS_TOKEN = "polar_test_token";

const { ensureDb } = await import("../../_lib/db/core.ts");
const { upsertBillingState, billingUsageFor } = await import("../../_lib/db/billing.ts");
const { jobPostGate } = await import("../../_lib/billing/enforce.ts");
const { recordMeterUsage } = await import("../../_lib/billing/entitlements.ts");
const { currentPeriod } = await import("../../_lib/billing/plans.ts");
const { classifyPublish, getJobStatus, insertJob, setJobStatus } = await import("../../_lib/job-ingest.ts");
const { DEFAULT_WORKSPACE_ID } = await import("../../_lib/db/workspaces.ts");

const WS = DEFAULT_WORKSPACE_ID;

/** The publish route's transaction body, in the shape it actually has: the billing
 *  decision comes from `classifyPublish`, so this exercises the SAME rule the route
 *  reads rather than a restatement of it. */
function publishOnce(id: string): { already: boolean; wasClosed: boolean; billed: boolean; refused: boolean } {
  return ensureDb().transaction(() => {
    const transition = classifyPublish(id);
    if (transition.already) return { already: true, wasClosed: false, billed: false, refused: false };
    const quota = transition.billable ? jobPostGate(new Date(), WS) : null;
    let billed = false;
    if (!quota) {
      setJobStatus(id, "published");
      if (transition.billable) {
        recordMeterUsage("job_posts", 1, new Date(), WS);
        billed = true;
      }
    }
    return { already: false, wasClosed: transition.wasClosed, billed, refused: Boolean(quota) };
  })();
}

const meter = () => billingUsageFor("job_posts", currentPeriod(new Date()));

test("a first publish bills the job_posts meter exactly once", () => {
  upsertBillingState({ plan: "growth", status: "active", provider: "polar" });
  const { id } = insertJob({ id: "jd-billing-first", title: "First go-live" } as never, undefined, "draft", WS);
  const before = meter();

  const out = publishOnce(id);
  assert.equal(out.refused, false, "a growth plan's role publishes");
  assert.equal(out.billed, true, "a role that has never been to market is billable");
  assert.equal(getJobStatus(id), "published");
  assert.equal(meter() - before, 1, "the go-live debited one job post");
});

test("re-publishing a live role is idempotent and never re-charges", () => {
  upsertBillingState({ plan: "growth", status: "active", provider: "polar" });
  const { id } = insertJob({ id: "jd-billing-idempotent", title: "Already live" } as never, undefined, "draft", WS);
  publishOnce(id);
  const after1 = meter();

  const out = publishOnce(id);
  assert.equal(out.already, true, "the row is already published");
  assert.equal(meter() - after1, 0, "an idempotent re-publish spends nothing");
});

test("REOPENING a closed role skips the gate and the debit", () => {
  // The regression this file exists for. FAILS on the pre-fix route, which tested
  // only `prevStatus === "published"`: the reopen below debited a second job post.
  upsertBillingState({ plan: "growth", status: "active", provider: "polar" });
  const { id } = insertJob({ id: "jd-billing-reopen", title: "Closed then reopened" } as never, undefined, "draft", WS);
  publishOnce(id);
  const afterFirst = meter();

  setJobStatus(id, "closed");
  assert.equal(getJobStatus(id), "closed");
  assert.equal(
    classifyPublish(id).billable,
    false,
    "published_at survives the close — the role has been to market, so the reopen is not billable",
  );

  const out = publishOnce(id);
  assert.equal(out.already, false, "a closed role is not 'already live' — the reopen does real work");
  assert.equal(out.wasClosed, true, "…and is flagged as a reopen, so the withdrawn entries are restored");
  assert.equal(out.billed, false, "the reopen must NOT debit the meter");
  assert.equal(getJobStatus(id), "published", "the role is live again");
  assert.equal(meter() - afterFirst, 0, "one opening, one charge — a reopen is free");

  // …and it stays free however many times the role cycles.
  setJobStatus(id, "closed");
  publishOnce(id);
  assert.equal(meter() - afterFirst, 0, "a second close/reopen cycle is free too");
});

test("a reopen is admitted even when the meter is exhausted", () => {
  // The sharper half of the same bug: on a plan whose job_posts allowance is spent,
  // the reopen used to take `jobPostGate` and be REFUSED 402 — the customer could not
  // reopen a role they had already paid for. `classifyPublish` never calls the gate for
  // a role that has been live, so the reopen is admitted.
  upsertBillingState({ plan: "growth", status: "active", provider: "polar" });
  const { id } = insertJob({ id: "jd-billing-exhausted", title: "Paid for once" } as never, undefined, "draft", WS);
  const first = publishOnce(id);
  assert.equal(first.refused, false, "the role goes live once, and is charged for once");
  setJobStatus(id, "closed");

  // Now exhaust the allowance: the free plan's included job posts are long gone in
  // this period (the tests above already debited it), so the gate refuses a NEW role.
  upsertBillingState({ plan: "free", status: "active", provider: "polar" });
  assert.ok(jobPostGate(new Date(), WS), "precondition: the gate now refuses a new role");

  const out = publishOnce(id);
  assert.equal(out.refused, false, "the reopen is admitted — it never asks the gate");
  assert.equal(out.billed, false, "and never debits");
  assert.equal(getJobStatus(id), "published");
});
