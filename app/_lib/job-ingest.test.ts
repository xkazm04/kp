// Behavioral guard for insertJob's id contract (bug-scan, api-jobs).
//
// The prose-ad ingest path does NOT name a job id: pipeline/jobfit/jobs.py mints one
// with `_slug_from_title`, a bare slug of the ad's TITLE with no uniqueness component.
// insertJob read "a row with this id already exists" as "the caller means update THAT
// job" — true for an explicit `jd-<slug>`, false for a minted slug — so two different
// roles sharing a title (the everyday shape of a bulk req-list paste: "Java Developer"
// in Prague and in Brno) collapsed into ONE row, the second ad's ON CONFLICT UPDATE
// overwriting the first role's title/company/salary/payload. Across tenants the same
// write crossed the boundary: the row keeps its original workspace_id and status, so
// team B's paste rewrote team A's live opening while B's own catalog gained nothing.
//
// `derivedId: true` marks the minted-slug case: it forks (`-2`, `-3`, …) instead of
// clobbering, and still lets the content-hash dedup resolve a genuine re-ingest first.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { insertJob } from "./job-ingest.ts";
import { getJob, getJobOwnerWorkspace } from "./db/jobs.ts";
import type { JobRecord } from "./db/core.ts";

after(() => cleanupUnitDb());

// insertJob only reads the fields it maps (all optional-guarded) and the reads parse
// payload_json back, so id + title + company are enough to assert on.
const job = (id: string, title: string, company: string): JobRecord =>
  ({ id, title, company }) as unknown as JobRecord;

test("a DERIVED id that collides forks a new role instead of overwriting the incumbent", () => {
  const first = insertJob(job("java-developer", "Java Developer", "Acme Praha"), "hash-praha", "draft", "ws-a", {
    derivedId: true,
  });
  assert.equal(first.id, "java-developer");
  assert.equal(first.created, true);

  // A DIFFERENT ad (different content hash) whose title slugs to the same id.
  const second = insertJob(job("java-developer", "Java Developer", "Beta Brno"), "hash-brno", "draft", "ws-a", {
    derivedId: true,
  });
  assert.notEqual(second.id, first.id, "the second role must get its own id, not the first's");
  assert.equal(second.created, true, "a distinct role is a creation, not a dedup hit");

  // Both roles survive, each with its own company — the merge is what this prevents.
  assert.equal(getJob("java-developer")?.company, "Acme Praha", "the first role must not be rewritten");
  assert.equal(getJob(second.id)?.company, "Beta Brno");
  // payload_json must carry the id the row is stored under, or every reader that
  // round-trips the payload (the browse list, the matcher) gets a phantom id.
  assert.equal(getJob(second.id)?.id, second.id, "the stored payload must carry the forked id");
});

test("a derived id still resolves a genuine re-ingest through the content hash (no -2 churn)", () => {
  const a = insertJob(job("qa-engineer", "QA Engineer", "Acme"), "hash-qa", "draft", "ws-a", { derivedId: true });
  const again = insertJob(job("qa-engineer", "QA Engineer", "Acme"), "hash-qa", "draft", "ws-a", { derivedId: true });
  assert.equal(again.id, a.id, "the same ad text must reuse its job");
  assert.equal(again.created, false);
});

test("a derived-id collision across tenants forks — team B never rewrites team A's opening", () => {
  insertJob(job("site-reliability-engineer", "Site Reliability Engineer", "Acme"), "hash-a-sre", "published", "ws-a", {
    derivedId: true,
  });
  const b = insertJob(job("site-reliability-engineer", "Site Reliability Engineer", "Beta"), "hash-b-sre", "draft", "ws-b", {
    derivedId: true,
  });

  assert.notEqual(b.id, "site-reliability-engineer");
  assert.equal(getJob("site-reliability-engineer")?.company, "Acme", "A's live opening must be untouched");
  assert.equal(getJobOwnerWorkspace("site-reliability-engineer"), "ws-a");
  assert.equal(getJobOwnerWorkspace(b.id), "ws-b", "B gets its OWN row instead of silently editing A's");
});

test("an EXPLICIT id still updates that job in place (the jd-<slug> re-save contract)", () => {
  insertJob(job("jd-explicit-role", "Draft Title", "Acme"), "hash-explicit-1", "draft", "ws-a");
  const again = insertJob(job("jd-explicit-role", "Corrected Title", "Acme"), "hash-explicit-2", "draft", "ws-a");
  assert.equal(again.id, "jd-explicit-role");
  assert.equal(again.created, false, "an explicit id targeting an existing row is an update");
  assert.equal(getJob("jd-explicit-role")?.title, "Corrected Title");
});
