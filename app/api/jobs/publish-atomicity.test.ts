// POST /api/jobs/[id]/publish wraps the quota gate, the status flip and the meter debit
// in ONE `ensureDb().transaction(...)` and says so: "a publish that is refused must not
// charge, and one that succeeds must not escape the meter". That claim only holds if
// all three run on the SAME connection. They did not: `setJobStatus` (job-ingest.ts)
// wrote through that module's own `openStore()` handle, so inside the route's
// transaction the sequence was
//
//   A: SELECT billing_state …        (jobPostGate — starts A's WAL read snapshot)
//   B: UPDATE jobs SET status …      (setJobStatus — commits on the OTHER connection)
//   A: INSERT INTO billing_usage …   (recordMeterUsage — A upgrades read → write)
//
// and SQLite answers the third step with SQLITE_BUSY_SNAPSHOT ("database is locked"):
// a WAL reader whose snapshot another connection has since committed past cannot
// become a writer. busy_timeout does not retry that code. The transaction rolled the
// debit back, the route answered 500 — and the flip on B had already committed, so
// the role was live, unmetered, under an error message. The exact inverse of the
// invariant the transaction was added to enforce.
//
// This drives the route's own sequence against the real modules on a throwaway DB
// (not the handler — it sits behind cookie auth). Same harness as billing-gate.test.ts.
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

// Metered (hosted) mode, like billing-gate.test.ts: the self-hosted install has no
// limit, but `recordMeterUsage` still writes the usage row there, so the sequence
// below fails identically either way — this just makes the gate a real gate.
process.env.POLAR_ACCESS_TOKEN = "polar_test_token";

const { ensureDb } = await import("../../_lib/db/core.ts");
const { upsertBillingState, billingUsageFor } = await import("../../_lib/db/billing.ts");
const { jobPostGate } = await import("../../_lib/billing/enforce.ts");
const { recordMeterUsage } = await import("../../_lib/billing/entitlements.ts");
const { currentPeriod } = await import("../../_lib/billing/plans.ts");
const { getJobStatus, insertJob, setJobStatus } = await import("../../_lib/job-ingest.ts");
const { getJobOwnerWorkspace } = await import("../../_lib/db/jobs.ts");
const { DEFAULT_WORKSPACE_ID } = await import("../../_lib/db/workspaces.ts");

const WS = DEFAULT_WORKSPACE_ID;

test("publish's gate → flip → debit transaction commits as one unit", () => {
  upsertBillingState({ plan: "growth", status: "active", provider: "polar" });
  const { id } = insertJob({ id: "jd-atomicity-probe", title: "Atomicity probe" } as never, undefined, "draft", WS);
  assert.equal(getJobStatus(id), "draft");
  assert.equal(getJobOwnerWorkspace(id), WS);
  const before = billingUsageFor("job_posts", currentPeriod(new Date()));

  // The route's transaction body, verbatim in shape.
  const gate = ensureDb().transaction(() => {
    const prevStatus = getJobStatus(id);
    if (prevStatus === "published") return { already: true, quota: null };
    const quota = jobPostGate(new Date(), WS);
    if (!quota) {
      setJobStatus(id, "published");
      recordMeterUsage("job_posts", 1, new Date(), WS);
    }
    return { already: false, quota };
  });

  // Must not throw SQLITE_BUSY_SNAPSHOT — and afterwards the flip and the debit
  // must AGREE: both landed, or neither did.
  const out = gate();
  assert.equal(out.quota, null, "a growth plan's first role publishes");
  assert.equal(getJobStatus(id), "published", "the status flip committed");
  assert.equal(
    billingUsageFor("job_posts", currentPeriod(new Date())) - before,
    1,
    "the debit committed with it — a live role never escapes the meter",
  );
});
