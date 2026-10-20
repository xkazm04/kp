import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { ensureDb } from "./db/core.ts";
import { runGoLive, type RunGoLiveDeps } from "./golive-run.ts";
import { openReceipt, readReceipt, claimResume, GOLIVE_FAILURE_CODES } from "./golive-receipt-store.ts";
import { PipelineError } from "./python-runner.ts";
import { listPipeline, createPipelineEntry } from "./db/pipeline.ts";

after(() => cleanupUnitDb());

const WS = "ws-golive-run-test";

function seedJob(data: { id?: string; title: string; seniority?: string; roleFamily?: string; description?: string; requirements?: { skill: string; kind?: string }[]; status?: string }, ws: string) {
  const db = ensureDb();
  const id = data.id ?? `job-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const payload = {
    id,
    title: data.title,
    seniority: data.seniority,
    roleFamily: data.roleFamily,
    description: data.description,
    requirements: data.requirements ?? [],
  };
  db.prepare(
    `INSERT INTO jobs (id, title, payload_json, status, workspace_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, data.title, JSON.stringify(payload), data.status ?? "published", ws, new Date().toISOString());
  return { id, ...data };
}

test("Acceptance 5: Aborted signal leaves receipt 'abandoned'; resume mode adds matches and marks 'done'", async () => {
  const job = seedJob(
    {
      title: "Backend Engineer",
      seniority: "senior",
      roleFamily: "engineering",
      description: "Build robust distributed systems",
      requirements: [{ skill: "Go", kind: "must" }],
    },
    WS
  );
  assert.ok(job);

  // 1. First run: signal aborts during sourcing
  openReceipt(job.id, WS);
  const controller = new AbortController();
  controller.abort();

  const abortSource = async () => {
    throw new Error("aborted");
  };

  const res1 = await runGoLive(
    {
      jobId: job.id,
      workspaceId: WS,
      signal: controller.signal,
      mode: "first",
      attempt: 1,
    },
    {
      source: abortSource as unknown as NonNullable<RunGoLiveDeps["source"]>,
    }
  );

  assert.equal(res1.sourcingAbandoned, true);
  const receipt1 = readReceipt(job.id, WS);
  assert.ok(receipt1);
  assert.equal(receipt1.state, "abandoned");
  assert.equal(receipt1.failureCode, "ABORTED");

  // 2. Second run: resume mode with 2 matching candidates
  const attempt2 = claimResume(job.id, WS);
  assert.equal(attempt2, 2);

  const resumeSource = async () => ({
    skipped: 0,
    candidates: [
      { candidateId: "c1", label: "Candidate One", archetype: "Backend", score: 85 },
      { candidateId: "c2", label: "Candidate Two", archetype: "Backend", score: 90 },
    ],
  });
  const mockRaise = async () => ({ raised: 1, failed: false });

  const res2 = await runGoLive(
    {
      jobId: job.id,
      workspaceId: WS,
      mode: "resume",
      attempt: attempt2,
    },
    {
      source: resumeSource as unknown as NonNullable<RunGoLiveDeps["source"]>,
      raise: mockRaise as unknown as NonNullable<RunGoLiveDeps["raise"]>,
    }
  );

  assert.equal(res2.alreadyPublished, true);
  assert.equal(res2.resumed, true);
  assert.equal(res2.sourced, 2);

  const receipt2 = readReceipt(job.id, WS);
  assert.ok(receipt2);
  assert.equal(receipt2.state, "done");
  assert.equal(receipt2.sourced, 2);
  assert.equal(receipt2.silverMedalists, 1);

  // 2 pipeline entries exist for the job
  const entries = listPipeline(WS).filter((e) => e.jobId === job.id);
  assert.equal(entries.length, 2);
});

test("a failed sourcing run stores a CODE, never the error's text", async () => {
  // The sourcing child is handed every candidate profile in the workspace, so its stderr
  // (which is what a PipelineError's message is) can carry person data. The receipt is
  // ERASURE_EXEMPT and GET /api/jobs/[id]/publish serves it, so the message must not
  // reach the row. See goliveFailureCodeFor.
  const PII = "Traceback (most recent call last): matched Jane Example cand-123";
  const job = seedJob({ title: "Platform Engineer", roleFamily: "engineering" }, WS);
  openReceipt(job.id, WS);

  const res = await runGoLive(
    { jobId: job.id, workspaceId: WS, mode: "first", attempt: 1 },
    {
      source: (async () => {
        throw new Error(`stderr: …${PII}`);
      }) as unknown as NonNullable<RunGoLiveDeps["source"]>,
    }
  );
  assert.equal(res.sourcingAbandoned, false);

  const receipt = readReceipt(job.id, WS);
  assert.ok(receipt);
  assert.equal(receipt.state, "sourcing_failed");
  assert.equal(receipt.failureCode, "SOURCING_FAILED");
  assert.ok((GOLIVE_FAILURE_CODES as readonly string[]).includes(receipt.failureCode ?? ""));
  assert.ok(!receipt.failureCode?.includes("Jane Example"));

  // Nothing of the message survives in the row itself, in any column.
  const row = ensureDb()
    .prepare(`SELECT * FROM job_golive_receipts WHERE job_id = ? AND workspace_id = ?`)
    .get(job.id, WS) as Record<string, unknown>;
  assert.ok(!JSON.stringify(row).includes("Jane Example"));

  // The transient warning is out of scope by design: it is returned to this one caller
  // and never stored.
  assert.ok(res.sourcingWarning?.includes("Jane Example"));
});

test("a PipelineError carrying a known engine code keeps that code, upper-cased", async () => {
  const job = seedJob({ title: "ML Engineer", roleFamily: "data" }, WS);
  openReceipt(job.id, WS);

  await runGoLive(
    { jobId: job.id, workspaceId: WS, mode: "first", attempt: 1 },
    {
      source: (async () => {
        throw new PipelineError({
          message: "stderr: …profile cand-456 for Jane Example could not be scored",
          status: 500,
          code: "engine_error",
        });
      }) as unknown as NonNullable<RunGoLiveDeps["source"]>,
    }
  );

  const receipt = readReceipt(job.id, WS);
  assert.equal(receipt?.failureCode, "ENGINE_ERROR");

  // An engine code OUTSIDE the vocabulary falls back rather than passing prose through.
  const job2 = seedJob({ title: "SRE", roleFamily: "engineering" }, WS);
  openReceipt(job2.id, WS);
  await runGoLive(
    { jobId: job2.id, workspaceId: WS, mode: "first", attempt: 1 },
    {
      source: (async () => {
        throw new PipelineError({ message: "Jane Example cand-789", status: 429, code: "rate_limited" });
      }) as unknown as NonNullable<RunGoLiveDeps["source"]>,
    }
  );
  assert.equal(readReceipt(job2.id, WS)?.failureCode, "SOURCING_FAILED");
});

test("Acceptance 6: Honest count - only newly created entries count toward sourced", async () => {
  const job = seedJob(
    {
      title: "Data Analyst",
      seniority: "mid",
      roleFamily: "data",
      description: "Analyze product metrics",
      requirements: [{ skill: "SQL", kind: "must" }],
    },
    WS
  );
  assert.ok(job);

  // Pre-seed an existing pipeline entry for candidate c1 on this job
  createPipelineEntry({
    candidateId: "cand-existing",
    candidateLabel: "Existing Candidate",
    archetype: "Data",
    jobId: job.id,
    jobTitle: job.title,
    matchScore: 80,
    stage: "Accepted",
    workspaceId: WS,
  });

  openReceipt(job.id, WS);

  // Source returns 2 candidates: one existing and one brand new
  const sourceWithDuplicate = async () => ({
    skipped: 0,
    candidates: [
      { candidateId: "cand-existing", label: "Existing Candidate", archetype: "Data", score: 80 },
      { candidateId: "cand-brand-new", label: "New Candidate", archetype: "Data", score: 95 },
    ],
  });
  const mockRaise = async () => ({ raised: 0, failed: false });

  const res = await runGoLive(
    {
      jobId: job.id,
      workspaceId: WS,
      mode: "first",
      attempt: 1,
    },
    {
      source: sourceWithDuplicate as unknown as NonNullable<RunGoLiveDeps["source"]>,
      raise: mockRaise as unknown as NonNullable<RunGoLiveDeps["raise"]>,
    }
  );

  // result.sourced should be 1 because only createPipelineEntry(...).created rows count
  assert.equal(res.sourced, 1);
  const receipt = readReceipt(job.id, WS);
  assert.ok(receipt);
  assert.equal(receipt.state, "done");
  assert.equal(receipt.sourced, 1);
});
