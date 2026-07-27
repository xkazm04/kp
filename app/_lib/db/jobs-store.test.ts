import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { listJobs, listCorpusJobs, canWriteJobLifecycle, getJobOwnerWorkspace } from "./jobs.ts";
import { insertJob, listJobStatuses } from "../job-ingest.ts";
import type { JobRecord } from "./core.ts";

after(() => cleanupUnitDb());

// Minimal JobRecord — insertJob only reads the fields it maps (all optional-guarded),
// and the reads parse payload_json back, so id + title are enough to assert on.
const job = (id: string, title: string): JobRecord => ({ id, title }) as unknown as JobRecord;

// Behavioral tenant-isolation for the jobs corpus (P1). The DUAL model: the seeded
// corpus (workspace_id NULL) is shared reference every team sees; authored openings
// are team-private.

test("the seeded corpus (workspace_id NULL) is shared reference — visible to every team", () => {
  const a = listCorpusJobs("ws-a").length;
  const b = listCorpusJobs("ws-b").length;
  assert.ok(a > 0, "the shared corpus is non-empty");
  assert.equal(a, b, "two teams with no openings of their own see the SAME shared corpus");
});

test("an authored, published opening is team-scoped; the shared corpus stays visible", () => {
  const before = listCorpusJobs("ws-a").length;
  insertJob(job("jd-ws-a-role", "WS A Role"), undefined, "published", "ws-a");

  // ws-a: shared corpus + its own published opening. ws-b: shared corpus only.
  assert.equal(listCorpusJobs("ws-a").length, before + 1);
  assert.equal(listCorpusJobs("ws-b").length, before);
  assert.ok(!listCorpusJobs("ws-b").some((j) => j.id === "jd-ws-a-role"), "ws-b must not match against ws-a's opening");

  // The browse list is scoped the same way.
  assert.ok(listJobs({}, "ws-a").some((j) => j.id === "jd-ws-a-role"));
  assert.ok(!listJobs({}, "ws-b").some((j) => j.id === "jd-ws-a-role"));

  // Authored lifecycle status is team-private.
  assert.equal(listJobStatuses("ws-a")["jd-ws-a-role"], "published");
  assert.equal(listJobStatuses("ws-b")["jd-ws-a-role"], undefined);
});

test("content-hash dedup is per-workspace — teams never share a job for identical ad text", () => {
  const hash = "shared-content-hash-xyz";
  assert.equal(insertJob(job("jd-a-first", "First"), hash, "draft", "ws-a").created, true);

  // Same team, same content, a DIFFERENT id → dedup reuses the first job.
  const dup = insertJob(job("jd-a-second", "Second"), hash, "draft", "ws-a");
  assert.equal(dup.created, false);
  assert.equal(dup.id, "jd-a-first", "same-team identical content reuses the first job");

  // Same content, a DIFFERENT team → its OWN job (never reuses ws-a's).
  const other = insertJob(job("jd-b-first", "B First"), hash, "draft", "ws-b");
  assert.equal(other.created, true);
  assert.equal(other.id, "jd-b-first");
});

// Lifecycle ownership (the gate /api/jobs/[id]/close|publish apply before the unscoped
// setJobStatus write). Behavioral counterpart to the source guard in jobs-tenancy.test.ts.
test("canWriteJobLifecycle: own + seeded rows are writable, another team's authored job is not", () => {
  insertJob(job("jd-owned-by-a", "A Role"), undefined, "draft", "ws-a");
  assert.equal(canWriteJobLifecycle("jd-owned-by-a", "ws-a"), true, "the owning team may close/publish its role");
  assert.equal(canWriteJobLifecycle("jd-owned-by-a", "ws-b"), false, "another team must not flip A's lifecycle");

  // A seeded corpus row (workspace_id NULL) is shared: every team may adopt/retire it.
  const seeded = listCorpusJobs("ws-a").find((j) => !listJobStatuses("ws-a")[j.id]);
  assert.ok(seeded, "precondition: the shared corpus has a seeded row");
  assert.equal(getJobOwnerWorkspace(seeded.id), null, "precondition: seeded rows carry workspace_id NULL");
  assert.equal(canWriteJobLifecycle(seeded.id, "ws-a"), true);
  assert.equal(canWriteJobLifecycle(seeded.id, "ws-b"), true);
});
