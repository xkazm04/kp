import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import {
  listJobs,
  listJobsPage,
  countJobs,
  countOpenRoles,
  listCorpusJobs,
  canWriteJobLifecycle,
  getJobOwnerWorkspace,
} from "./jobs.ts";
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

// listJobs is a PAGE, not the corpus: no `limit` binds LIMIT 300 and a supplied one is
// capped at 500. It used to truncate in silence, so `.length` read like a count — the
// analytics metric pack did exactly that and published "300 open roles" for a workspace
// carrying 350 (30 roles/recruiter instead of 35), labelled `measured`. The page now
// carries buildCandidatePool's `truncated` contract and countJobs is the count.
test("listJobsPage reports truncation; countJobs is the count a page can't be", () => {
  const total = countJobs({}, "ws-page");
  assert.ok(total > 2, "precondition: the shared corpus holds more than 2 rows");

  const cut = listJobsPage({ limit: 2 }, "ws-page");
  assert.equal(cut.jobs.length, 2, "the page honors the limit");
  assert.equal(cut.limit, 2);
  assert.equal(cut.truncated, true, "a cut slice must SAY it was cut");
  assert.notEqual(cut.jobs.length, total, "the page length is not the count");
  assert.equal(countJobs({ limit: 2 }, "ws-page"), total, "a count ignores `limit` — a count is not a page");

  // A page that fits reports truncated=false and equals the count.
  const whole = listJobsPage({ limit: 500 }, "ws-page");
  assert.equal(whole.truncated, false, "an uncut page must not claim truncation");
  assert.equal(whole.jobs.length, total);

  // The bare-array contract the catalog UI consumes is unchanged.
  assert.equal(listJobs({ limit: 2 }, "ws-page").length, 2);

  // Filters flow through both halves identically.
  assert.equal(countJobs({ q: "____no_such_title____" }, "ws-page"), 0);
  assert.equal(listJobsPage({ q: "____no_such_title____" }, "ws-page").truncated, false);
});

// The dual-tier predicate `(workspace_id IS NULL OR workspace_id = ?)` presents the
// shared cross-company reference corpus as if it were the team's own openings, and
// JobRecord carries no workspaceId, so no caller could tell them apart. countOpenRoles
// is the primitive that makes the distinction expressible.
test("countOpenRoles separates a team's OWN live roles from the shared reference corpus", () => {
  const fresh = countOpenRoles("ws-tier");
  assert.ok(fresh.corpus > 0, "the shared reference corpus is non-empty");
  assert.equal(fresh.own, 0, "a workspace that authored nothing carries ZERO roles of its own");
  assert.equal(fresh.visible, fresh.corpus, "…yet the dual-tier predicate still shows it the whole corpus");

  insertJob(job("jd-tier-live", "Tier Live"), undefined, "published", "ws-tier");
  insertJob(job("jd-tier-draft", "Tier Draft"), undefined, "draft", "ws-tier");
  insertJob(job("jd-tier-other", "Other Team"), undefined, "published", "ws-tier-other");

  const after = countOpenRoles("ws-tier");
  assert.equal(after.own, 1, "only the team's own LIVE authored role counts (a draft is not open)");
  assert.equal(after.corpus, fresh.corpus, "the shared tier is untouched by authoring");
  assert.equal(after.visible, fresh.corpus + 1);

  // Another team's authored opening never lands in either tier here.
  const other = countOpenRoles("ws-tier-other");
  assert.equal(other.own, 1);
  assert.equal(other.visible, fresh.corpus + 1);
  assert.equal(countOpenRoles("ws-tier-none").own, 0);
});
