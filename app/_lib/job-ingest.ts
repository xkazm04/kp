import path from "node:path";
import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { openStore } from "./db-path";
import type { JobRecord } from "./db";
import { cleanupWorkdir, createWorkdir, parsePythonJson, parseStderrError, spawnPython } from "./python-runner";

// Direction #1: turn authored/ingested job descriptions into structured,
// matchable Job rows. insertJob writes into the SHARED `jobs` table (so
// listJobs / the matcher see it) via its own connection — WAL-safe — and a
// `job_ingests` table content-hash-guards re-ingestion of the same ad. The jobs
// DDL mirrors db.ts (idempotent) so this module is self-contained.

let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  const d = openStore();
  d.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, company TEXT, location TEXT, work_mode TEXT,
      seniority TEXT, role_family TEXT, employment_type TEXT, min_years REAL, min_education TEXT,
      languages TEXT, is_entry_eligible INTEGER DEFAULT 0, graduate_friendliness REAL DEFAULT 0,
      salary_min INTEGER, salary_max INTEGER, payload_json TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS job_ingests (content_hash TEXT PRIMARY KEY, job_id TEXT NOT NULL, created_at TEXT NOT NULL);
  `);
  // Phase 1: draft → publish lifecycle. The jobs table predates this column, so
  // ALTER it in (no-op if already present). NULL status = a seeded/live corpus
  // job; authored JDs are 'draft' until published.
  try {
    d.exec(`ALTER TABLE jobs ADD COLUMN status TEXT`);
  } catch {
    /* column already exists */
  }
  _db = d;
  return d;
}

export const jobContentHash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 24);

/**
 * Upsert a structured job into the corpus. With a contentHash, a previously
 * ingested identical ad is reused (returns its id, created=false) so the same
 * JD/ad doesn't pile up duplicate jobs.
 *
 * `status` seeds the lifecycle ONLY when a brand-new row is inserted; updating an
 * existing row preserves its stored status (setJobStatus owns transitions).
 */
export function insertJob(job: JobRecord, contentHash?: string, status: string = "published"): { id: string; created: boolean } {
  const d = db();
  // Contract for content-hash dedup vs. an explicit jobId:
  //   • If job.id already names an EXISTING row, the caller means "update THIS
  //     job" — the explicit id WINS over the content twin, so a lightly-corrected
  //     re-ingest (or a deliberate update under a known id) edits that row.
  //   • Otherwise we dedup by content hash: a re-ingest of identical ad text
  //     reuses the prior job (created=false) instead of forking a duplicate.
  const targetsExisting = !!d.prepare(`SELECT 1 FROM jobs WHERE id = ?`).get(job.id);
  if (contentHash && !targetsExisting) {
    const seen = d.prepare(`SELECT job_id FROM job_ingests WHERE content_hash = ?`).get(contentHash) as { job_id: string } | undefined;
    if (seen && d.prepare(`SELECT 1 FROM jobs WHERE id = ?`).get(seen.job_id)) {
      return { id: seen.job_id, created: false };
    }
  }
  const now = new Date().toISOString();
  // `status` is set ONLY on first INSERT — the ON CONFLICT UPDATE deliberately
  // omits it so re-upserting an existing row preserves its stored lifecycle
  // value. setJobStatus is the sole writer of transitions; if this UPDATE wrote
  // excluded.status it would clobber that: re-saving an already-published
  // authored JD (same jd-<slug> id) would revert it to 'draft', and re-ingesting
  // a prose ad under an explicit jobId would force-flip it to 'published'.
  d.prepare(
    `INSERT INTO jobs (id, title, company, location, work_mode, seniority, role_family, employment_type,
       min_years, min_education, languages, is_entry_eligible, graduate_friendliness, salary_min, salary_max, payload_json, status, created_at)
     VALUES (@id, @title, @company, @location, @work_mode, @seniority, @role_family, @employment_type,
       @min_years, @min_education, @languages, @is_entry_eligible, @graduate_friendliness, @salary_min, @salary_max, @payload_json, @status, @created_at)
     ON CONFLICT(id) DO UPDATE SET title=excluded.title, company=excluded.company, location=excluded.location,
       work_mode=excluded.work_mode, seniority=excluded.seniority, role_family=excluded.role_family,
       employment_type=excluded.employment_type, min_years=excluded.min_years, min_education=excluded.min_education,
       languages=excluded.languages, is_entry_eligible=excluded.is_entry_eligible, graduate_friendliness=excluded.graduate_friendliness,
       salary_min=excluded.salary_min, salary_max=excluded.salary_max, payload_json=excluded.payload_json`
  ).run({
    id: job.id,
    title: job.title,
    company: job.company ?? null,
    location: job.location ?? null,
    work_mode: job.workMode ?? null,
    seniority: job.seniority ?? null,
    role_family: job.roleFamily ?? null,
    employment_type: job.employmentType ?? null,
    min_years: job.minYearsExperience ?? null,
    min_education: job.minEducation ?? null,
    languages: JSON.stringify(job.languages ?? []),
    is_entry_eligible: job.entryProfile?.isEntryEligible ? 1 : 0,
    graduate_friendliness: job.entryProfile?.graduateFriendliness ?? 0,
    salary_min: job.salaryBand?.[0] ?? null,
    salary_max: job.salaryBand?.[1] ?? null,
    payload_json: JSON.stringify(job),
    status,
    created_at: now,
  });
  if (contentHash) {
    d.prepare(`INSERT INTO job_ingests (content_hash, job_id, created_at) VALUES (?, ?, ?) ON CONFLICT(content_hash) DO UPDATE SET job_id=excluded.job_id`).run(contentHash, job.id, now);
  }
  // created=false when we updated an existing row (explicit-jobId update path).
  return { id: job.id, created: !targetsExisting };
}

/** Flip a job's lifecycle status. W8-1 (JOB1) adds the terminal state the
 *  one-way draft → published ratchet lacked: `closed` retires a filled or
 *  abandoned role — the apply surface stops accepting, the catalog badges it.
 *  NULL status (seeded corpus job) remains "live". */
export function setJobStatus(jobId: string, status: "draft" | "published" | "closed"): void {
  db().prepare(`UPDATE jobs SET status = ? WHERE id = ?`).run(status, jobId);
}

/** Can candidates apply to this job right now? NULL (seeded/live) and
 *  published accept; a draft was never publicly live, and a closed role's
 *  apply link must stop collecting candidates nobody will process. ONE
 *  authority shared by the apply page (render) and the apply API (submission)
 *  — page-level gating alone is the documented anti-pattern. */
export function isJobOpenForApplications(status: string | null): boolean {
  return status === null || status === "published";
}

export function getJobStatus(jobId: string): string | null {
  const r = db().prepare(`SELECT status FROM jobs WHERE id = ?`).get(jobId) as { status: string | null } | undefined;
  return r?.status ?? null;
}

/** Authored jobs currently live — the count the billing active-jobs cap reads.
 *  Seeded corpus jobs carry NULL status and deliberately don't count. */
export function countPublishedJobs(): number {
  const r = db().prepare(`SELECT COUNT(*) AS n FROM jobs WHERE status = 'published'`).get() as { n: number };
  return r.n;
}

/** Map of jobId → status for jobs that carry one (the authored JDs). Seeded
 *  corpus jobs have NULL status and are treated as already live. */
export function listJobStatuses(): Record<string, string> {
  const rows = db().prepare(`SELECT id, status FROM jobs WHERE status IS NOT NULL`).all() as { id: string; status: string }[];
  return Object.fromEntries(rows.map((r) => [r.id, r.status]));
}

/** Draft JDs awaiting publish, newest first. */
export function listDraftJobs(): { id: string; title: string; company: string | null }[] {
  return db()
    .prepare(`SELECT id, title, company FROM jobs WHERE status = 'draft' ORDER BY created_at DESC`)
    .all() as { id: string; title: string; company: string | null }[];
}

type JobCliOut = { job: JobRecord; source: string };

/** Deterministically structure a role record (e.g. a JD-builder RoleSpec) into a Job. */
export async function normalizeJob(record: Record<string, unknown>, jobId?: string): Promise<JobCliOut> {
  return runJobsCli(["normalize", ...(jobId ? ["--job-id", jobId] : [])], "record.json", record);
}

/** Parse a prose job ad into a structured Job via the Claude CLI. `signal` aborts
 *  the LLM ad-parse child when the request is abandoned, so it stops burning
 *  subscription calls instead of running to the backstop. */
export async function ingestJobAd(adText: string, jobId?: string, signal?: AbortSignal): Promise<JobCliOut> {
  return runJobsCli(["ingest", ...(jobId ? ["--job-id", jobId] : [])], "ad.txt", adText, signal);
}

async function runJobsCli(cliArgs: string[], fileName: string, payload: unknown, signal?: AbortSignal): Promise<JobCliOut> {
  const workdir = await createWorkdir();
  try {
    const p = path.join(workdir, fileName);
    const isText = fileName.endsWith(".txt");
    await writeFile(p, isText ? String(payload) : JSON.stringify(payload), "utf-8");
    const flag = isText ? "--ad-file" : "--record-json";
    const { result } = spawnPython(["-m", "pipeline.jobfit.jobs_cli", ...cliArgs, flag, p], { signal });
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) throw new Error(parseStderrError(stderr, exitCode).message);
    return parsePythonJson<JobCliOut>(stdout, stderr);
  } finally {
    await cleanupWorkdir(workdir);
  }
}
