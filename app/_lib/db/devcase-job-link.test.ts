// Import the REAL native better-sqlite3 first (never a shim), so every store call
// below opens a genuine on-disk SQLite file.
import "better-sqlite3";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
// IMPORT ORDER IS LOAD-BEARING: unit-db sets KP_DB_PATH to a throwaway file at
// module-eval time and must run BEFORE any module that transitively touches db-path
// (devcase → core → db-path). Keep it above the app-module imports.
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { getDevCase, listDevCases, listDevCasesForJob, resolveCaseJobId, saveDevCase } from "./devcase.ts";
import { ensureDb } from "./core.ts";
import { insertJob } from "../job-ingest.ts";
import type { JobRecord } from "./core.ts";

// ONE THREAD (JD → assignment). The JD a recruiter picks in DevNeedForm used to live
// ONLY as `need_json.jdSlug` — a value inside an opaque blob that no query could join
// on — so the Jobs surface could not tell that a role had a work sample at all. These
// pin the column that replaced that: how it is resolved at write (verified, never
// assumed), what it reads back as, and that the "no ingested job" case stays honestly
// NULL instead of storing a link that goes nowhere.

const job = (id: string, title: string): JobRecord => ({ id, title }) as unknown as JobRecord;
const holder = globalThis as typeof globalThis & { __kpDb?: { close(): void } };

/** Drop the memoized connection so ensureDb() re-runs the whole CREATE/ALTER/seed/
 *  backfill initializer against the already-initialized file — exactly what a process
 *  restart does, which is the only way the backfill is ever observed. */
function reboot(): void {
  holder.__kpDb?.close();
  holder.__kpDb = undefined;
  ensureDb();
}

before(() => {
  // Force the full ensureDb() init (creates dev_cases + jobs + the job_id column).
  getDevCase("__init__");
});

after(() => cleanupUnitDb());

test("a case cut from a JD that HAS an ingested job carries that job id", () => {
  insertJob(job("jd-linked-role", "Linked Role"), undefined, "published", "workspace");

  const saved = saveDevCase({
    need: { title: "Linked", jdSlug: "linked-role" },
    analysis: {},
    role: { title: "Linked role" },
    case: { title: "Linked case" },
  });

  // NON-VACUITY: before the column existed saveDevCase returned only {id, createdAt}
  // and the row had no job_id at all, so both assertions below would fail.
  assert.equal(saved.jobId, "jd-linked-role", "the write resolves the job from the picked JD");
  const read = getDevCase(saved.id);
  assert.equal(read?.jobId, "jd-linked-role", "and the read gives it back");
  assert.equal(read?.jobTitle, "Linked Role", "the job's title is joined at read, not re-fetched by the caller");
  assert.equal(read?.jdSlug, "linked-role", "the picked JD stays on the record");
});

test("a JD with NO ingested job leaves job_id NULL — the slug is kept, the link is not invented", () => {
  const saved = saveDevCase({
    need: { title: "Unsourced", jdSlug: "never-ingested" },
    analysis: {},
    role: { title: "Unsourced role" },
    case: { title: "Unsourced case" },
  });

  assert.equal(saved.jobId, null, "a `jd-never-ingested` row does not exist, so no link is stored");
  const read = getDevCase(saved.id);
  assert.equal(read?.jobId, null);
  assert.equal(read?.jobTitle, null);
  // The pick is NOT lost — this is exactly the state the UI has to explain
  // ("JD picked, not sourced into a job yet") rather than silently show as unlinked.
  assert.equal(read?.jdSlug, "never-ingested", "the JD the recruiter picked survives the missing job");
});

test("a case with no JD at all has neither a job nor a slug", () => {
  const saved = saveDevCase({
    need: { title: "Freehand" },
    analysis: {},
    role: { title: "Freehand role" },
    case: { title: "Freehand case" },
  });
  const read = getDevCase(saved.id);
  assert.equal(read?.jobId, null);
  assert.equal(read?.jdSlug, null);
});

test("resolveCaseJobId verifies the job EXISTS rather than trusting the slug", () => {
  insertJob(job("jd-resolve-me", "Resolve Me"), undefined, "draft", "workspace");
  assert.equal(resolveCaseJobId({ jdSlug: "resolve-me" }), "jd-resolve-me");
  assert.equal(resolveCaseJobId({ jdSlug: "no-such-jd" }), null, "an unverified slug must not become a stored link");
  assert.equal(resolveCaseJobId({ jdSlug: "   " }), null, "a blank slug is not a JD");
  assert.equal(resolveCaseJobId({}), null);
  assert.equal(resolveCaseJobId(null), null);
});

test("listDevCasesForJob returns this job's assignments only, newest first, scoped to the team", () => {
  insertJob(job("jd-busy-role", "Busy Role"), undefined, "published", "workspace");
  insertJob(job("jd-quiet-role", "Quiet Role"), undefined, "published", "workspace");

  const first = saveDevCase(
    { need: { jdSlug: "busy-role" }, analysis: {}, role: { title: "Busy" }, case: { title: "Busy A" } },
    "workspace"
  );
  const second = saveDevCase(
    { need: { jdSlug: "busy-role" }, analysis: {}, role: { title: "Busy" }, case: { title: "Busy B" } },
    "workspace"
  );
  const other = saveDevCase(
    { need: { jdSlug: "quiet-role" }, analysis: {}, role: { title: "Quiet" }, case: { title: "Quiet A" } },
    "workspace"
  );

  const linked = listDevCasesForJob("jd-busy-role");
  const ids = linked.map((c) => c.id);
  assert.ok(ids.includes(first.id) && ids.includes(second.id), "both of this job's assignments are listed");
  assert.ok(!ids.includes(other.id), "another job's assignment is not");

  // ENUMERATION, so it is the caller's tenant that decides — not the job id.
  assert.equal(listDevCasesForJob("jd-busy-role", "ws-other").length, 0, "another team sees none of them");
});

test("the pre-column backfill recovers a link from need_json — but only when the job is real", () => {
  insertJob(job("jd-legacy-role", "Legacy Role"), undefined, "published", "workspace");
  const db = ensureDb();
  const now = new Date().toISOString();
  const insertLegacy = db.prepare(
    `INSERT INTO dev_cases (id, title, role_title, seniority, need_json, analysis_json, role_json, case_json, status, created_at, workspace_id, job_id)
     VALUES (?, ?, NULL, NULL, ?, '{}', '{}', '{}', 'approved', ?, 'workspace', NULL)`
  );
  // Exactly the shape a case written before dev_cases.job_id existed has: the JD lives
  // inside the blob and the column is NULL.
  insertLegacy.run("dc-legacy-linked", "Legacy linked", JSON.stringify({ jdSlug: "legacy-role" }), now);
  insertLegacy.run("dc-legacy-orphan", "Legacy orphan", JSON.stringify({ jdSlug: "legacy-gone" }), now);
  insertLegacy.run("dc-legacy-nojd", "Legacy no JD", JSON.stringify({ title: "no jd here" }), now);

  assert.equal(getDevCase("dc-legacy-linked")?.jobId, null, "precondition: the legacy rows start unlinked");

  reboot();

  assert.equal(getDevCase("dc-legacy-linked")?.jobId, "jd-legacy-role", "the JD's real job is recovered");
  assert.equal(getDevCase("dc-legacy-orphan")?.jobId, null, "a JD with no ingested job stays NULL");
  assert.equal(getDevCase("dc-legacy-nojd")?.jobId, null, "a case with no JD stays NULL");

  // Idempotent: a second boot must not change what the first decided.
  reboot();
  assert.equal(getDevCase("dc-legacy-linked")?.jobId, "jd-legacy-role");
  assert.ok(listDevCases(200).length > 0, "the list read survives the join it now carries");
});
