// Go-live leaves a durable receipt (challenge-r10 jobs-posting-campaign/A).
//
// POST /api/jobs/[id]/publish is two acts in one request: a transaction that flips
// the role live and bills it, then minutes of sourcing + the rediscovery raise tied
// to the request's lifetime. Before this, an abandoned or failed second act left the
// role "live, billed, never sourced" for good — every later publish short-circuits
// on `already` — and the only record of the outcome was a module-scope Map in the
// browser. These cases pin the receipt store (golive-receipt-store.ts), its CAS
// resume, and the post-commit half moved out of the route (golive-run.ts), driven
// with injected source/raise deps so no Python child is spawned.
//   node scripts/run-unit-tests.mjs app/_lib/golive-run.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";

process.env.PYTHON_CMD = "kp-no-python-for-this-test";
// Metered mode, as publish-atomicity.test.ts: the debit is a real write in the
// go-live transaction the receipt joins.
process.env.POLAR_ACCESS_TOKEN = "polar_test_token";

const { ensureDb } = await import("./db/core.ts");
const { DEFAULT_WORKSPACE_ID } = await import("./db/workspaces.ts");
const { createPipelineEntry } = await import("./db/pipeline.ts");
const { getJob } = await import("./db/jobs.ts");
const { upsertBillingState, billingUsageFor } = await import("./db/billing.ts");
const { jobPostGate } = await import("./billing/enforce.ts");
const { recordMeterUsage } = await import("./billing/entitlements.ts");
const { currentPeriod } = await import("./billing/plans.ts");
const { getJobStatus, insertJob, setJobStatus } = await import("./job-ingest.ts");
const { openReceipt, finishReceipt, claimResume, readReceipt } = await import("./golive-receipt-store.ts");
const { runGoLive } = await import("./golive-run.ts");

after(() => cleanupUnitDb());

const WS = DEFAULT_WORKSPACE_ID;
let seq = 0;
const nextJobId = (p = "golive") => `${p}-job-${++seq}`;

/** Open a receipt the way the route does: inside ONE ensureDb() transaction. */
function openInTx(jobId: string, now = new Date()): number {
  return ensureDb().transaction(() => openReceipt(jobId, WS, now))();
}

function seedLiveJob(id: string) {
  insertJob({ id, title: "Receipt probe", roleFamily: "engineering" } as never, undefined, "draft", WS);
  setJobStatus(id, "published", WS);
  const job = getJob(id, WS);
  assert.ok(job, "fixture job exists");
  return job!;
}

const match = (candidateId: string, score = 80) => ({ candidateId, label: `Cand ${candidateId}`, archetype: null, score, matchedSkills: [] });
const sourceOf = (ids: string[]) => async () => ({ candidates: ids.map((c) => match(c)), skipped: 0, skippedReasons: [] });
const quietRaise = async () => ({ raised: 0, failed: false });
const entriesFor = (jobId: string) =>
  (ensureDb().prepare(`SELECT COUNT(*) AS n FROM pipeline_entries WHERE job_id = ? AND workspace_id = ?`).get(jobId, WS) as { n: number }).n;

test("store: a receipt opened inside a transaction reads 'sourcing' attempt 1; finishing it records the counts", () => {
  const jobId = nextJobId();
  assert.equal(openInTx(jobId), 1);
  const open = readReceipt(jobId, WS);
  assert.equal(open?.state, "sourcing");
  assert.equal(open?.attempt, 1);
  assert.equal(open?.finishedAt, null);

  const changed = finishReceipt(jobId, WS, 1, { state: "done", sourced: 2, skipped: 0, silverMedalists: 1 });
  assert.equal(changed, 1);
  const done = readReceipt(jobId, WS);
  assert.equal(done?.state, "done");
  assert.equal(done?.sourced, 2);
  assert.equal(done?.skipped, 0);
  assert.equal(done?.silverMedalists, 1);
  assert.equal(typeof done?.finishedAt, "string");
});

test("a stale finisher is dropped: attempt 1 cannot finish a row a resume moved to attempt 2", () => {
  const jobId = nextJobId();
  openInTx(jobId);
  finishReceipt(jobId, WS, 1, { state: "abandoned" });
  assert.equal(claimResume(jobId, WS, new Date()), 2);
  assert.equal(finishReceipt(jobId, WS, 1, { state: "done", sourced: 9 }), 0, "the CAS on attempt drops the late writer");
  const r = readReceipt(jobId, WS);
  assert.equal(r?.attempt, 2);
  assert.equal(r?.state, "sourcing");
  assert.equal(r?.sourced, 0);
});

test("CAS resume: an abandoned receipt is claimed exactly once", () => {
  const jobId = nextJobId();
  openInTx(jobId);
  finishReceipt(jobId, WS, 1, { state: "abandoned" });
  assert.equal(claimResume(jobId, WS, new Date()), 2);
  assert.equal(claimResume(jobId, WS, new Date()), null, "a double click loses the CAS");
});

test("resumability window: done never resumes, a fresh run is left alone, a dead run resumes", () => {
  const now = new Date("2026-09-24T12:00:00Z");
  const done = nextJobId();
  openInTx(done, new Date(now.getTime() - 3_600_000));
  finishReceipt(done, WS, 1, { state: "done", sourced: 1 });
  assert.equal(claimResume(done, WS, now), null);

  const fresh = nextJobId();
  openInTx(fresh, new Date(now.getTime() - 60_000));
  assert.equal(claimResume(fresh, WS, now), null, "a run started a minute ago may still be in flight");

  const dead = nextJobId();
  openInTx(dead, new Date(now.getTime() - 30 * 60_000));
  assert.equal(claimResume(dead, WS, now), 2, "a run that never finished in 30 minutes died with its process");

  for (const failed of ["sourcing_failed", "raise_failed"] as const) {
    const id = nextJobId();
    openInTx(id);
    finishReceipt(id, WS, 1, { state: failed });
    assert.equal(claimResume(id, WS, new Date()), 2, `${failed} is resumable`);
  }
});

test("runGoLive: an aborted sweep leaves 'abandoned'; the resume sources and finishes 'done'", async () => {
  const jobId = nextJobId();
  const job = seedLiveJob(jobId);
  const attempt = openInTx(jobId);
  const ctl = new AbortController();
  const first = await runGoLive(
    { jobId, job, workspaceId: WS, signal: ctl.signal, attempt, mode: "first" },
    {
      source: async () => {
        ctl.abort();
        throw new Error("sourcing child killed");
      },
      raise: quietRaise,
    },
  );
  assert.equal(first.sourcingAbandoned, true);
  assert.equal(readReceipt(jobId, WS)?.state, "abandoned");
  assert.equal(entriesFor(jobId), 0);

  const claimed = claimResume(jobId, WS, new Date());
  assert.equal(claimed, 2);
  const resumed = await runGoLive(
    { jobId, job, workspaceId: WS, signal: new AbortController().signal, attempt: claimed!, mode: "resume" },
    { source: sourceOf(["gl-a", "gl-b"]), raise: quietRaise },
  );
  assert.equal(resumed.alreadyPublished, true);
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.sourced, 2);
  assert.equal(resumed.sourcingAbandoned, false);
  assert.equal(entriesFor(jobId), 2);
  const r = readReceipt(jobId, WS);
  assert.equal(r?.state, "done");
  assert.equal(r?.sourced, 2);
});

test("honest count: a match whose entry already exists is not reported as sourced", async () => {
  const jobId = nextJobId();
  const job = seedLiveJob(jobId);
  // The entry reopenEntriesByJobId restored (or any earlier sourcing) — already on the board.
  createPipelineEntry({ candidateId: "gl-old", candidateLabel: "Cand gl-old", jobId, jobTitle: job.title, stage: "Accepted", workspaceId: WS });
  const attempt = openInTx(jobId);
  const out = await runGoLive(
    { jobId, job, workspaceId: WS, signal: new AbortController().signal, attempt, mode: "first" },
    { source: sourceOf(["gl-old", "gl-new"]), raise: quietRaise },
  );
  assert.equal(out.sourced, 1, "only createPipelineEntry(...).created rows count");
  assert.equal(entriesFor(jobId), 2);
  assert.equal(readReceipt(jobId, WS)?.sourced, 1);
});

test("a failed sweep and a failed raise are distinct, resumable states — not a quiet done", async () => {
  const a = nextJobId();
  const jobA = seedLiveJob(a);
  const outA = await runGoLive(
    { jobId: a, job: jobA, workspaceId: WS, signal: new AbortController().signal, attempt: openInTx(a), mode: "first" },
    { source: async () => { throw new Error("python exploded"); }, raise: quietRaise },
  );
  assert.equal(typeof outA.sourcingWarning, "string");
  assert.equal(readReceipt(a, WS)?.state, "sourcing_failed");

  const b = nextJobId();
  const jobB = seedLiveJob(b);
  const outB = await runGoLive(
    { jobId: b, job: jobB, workspaceId: WS, signal: new AbortController().signal, attempt: openInTx(b), mode: "first" },
    { source: sourceOf(["gl-r1"]), raise: async () => ({ raised: 0, failed: true }) },
  );
  assert.equal(outB.silverMedalistsFailed, true);
  const rb = readReceipt(b, WS);
  assert.equal(rb?.state, "raise_failed");
  assert.equal(rb?.sourced, 1);
});

test("openReceipt joins the go-live transaction on the SAME connection: flip, debit and receipt commit together", () => {
  // The critic's revise: a store on its own connection inside this transaction is the
  // SQLITE_BUSY_SNAPSHOT shape publish-atomicity.test.ts was written for (the debit
  // rolls back, the role is live and unmetered). Drive the route's sequence with the
  // receipt in it — first open on a fresh DB file included, so the lazy CREATE runs
  // inside the transaction too.
  upsertBillingState({ plan: "growth", status: "active", provider: "polar" });
  const { id } = insertJob({ id: "golive-atomic-probe", title: "Atomic receipt probe" } as never, undefined, "draft", WS);
  const before = billingUsageFor("job_posts", currentPeriod(new Date()));
  const out = ensureDb().transaction(() => {
    const quota = jobPostGate(new Date(), WS);
    if (quota) return { quota, attempt: null };
    setJobStatus(id, "published", WS);
    recordMeterUsage("job_posts", 1, new Date(), WS);
    return { quota, attempt: openReceipt(id, WS) };
  })();
  assert.equal(out.quota, null);
  assert.equal(out.attempt, 1);
  assert.equal(getJobStatus(id, WS), "published");
  assert.equal(billingUsageFor("job_posts", currentPeriod(new Date())) - before, 1);
  assert.equal(readReceipt(id, WS)?.state, "sourcing");
});
