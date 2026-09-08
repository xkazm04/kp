import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { randomId } from "../random-id";
import { ensureDb } from "./core";
import { markSeedRan, seedAlreadyRan } from "./seed-marks";
import { DEFAULT_WORKSPACE_ID } from "./workspaces";

// The posting corpus (docs/features/intake/README.md) — real job advertisements the
// intake studio grounds on: the imported reference material a requestor's brief is
// compared against, and the pool `distinctRolePostings` samples a stratified set of
// roles from.
//
// Tenancy: every row carries the IMPORTING workspace's id — deliberately NOT the
// dual-tier NULL-means-shared model `jobs` and `jd_templates` use. A posting is
// imported ON REQUEST, per team (a seed run, a paste, a fetched URL), and
// `distinctRolePostings` is a per-team sample, so a shared tier would let one team's
// pasted competitor ad appear in another's. Every query filters or stamps
// workspace_id, point reads included (job-postings-tenancy.test.ts).

// Closed vocabulary, house pattern: literal array + derived union + runtime guard.
// Mirrored by the CHECK constraint on job_postings.source in db/core.ts — a value the
// guard rejects is also a value SQLite would refuse.
export const JOB_POSTING_SOURCES = ["seed_calibration", "seed_jobs", "paste", "url", "crawler"] as const;
export type JobPostingSource = (typeof JOB_POSTING_SOURCES)[number];

export function isJobPostingSource(value: unknown): value is JobPostingSource {
  return typeof value === "string" && (JOB_POSTING_SOURCES as readonly string[]).includes(value);
}

export type JobPosting = {
  id: string;
  workspaceId: string;
  source: JobPostingSource;
  /** Where the row came from WITHIN its source: the corpus record's own id, or the
   *  fetched URL. Never a secret — it is echoed back to the operator who imported it. */
  sourceRef: string | null;
  title: string;
  company: string | null;
  roleFamily: string | null;
  seniority: string | null;
  lang: string | null;
  bodyText: string;
  contentHash: string;
  fetchedAt: string | null;
  createdAt: string;
};

/** The ledger projection: everything except the body, the hash and the tenant id — a
 *  list of 200 postings must not ship 200 full advertisements to the browser, and the
 *  workspace id is the caller's own and carries no information for it. `bodyChars` is
 *  what the list actually needs from the body. */
export type JobPostingSummary = Omit<JobPosting, "bodyText" | "contentHash" | "workspaceId"> & { bodyChars: number };

type PostingRow = {
  id: string;
  workspace_id: string;
  source: string;
  source_ref: string | null;
  title: string;
  company: string | null;
  role_family: string | null;
  seniority: string | null;
  lang: string | null;
  body_text: string;
  content_hash: string;
  fetched_at: string | null;
  created_at: string;
};

type SummaryRow = Omit<PostingRow, "body_text" | "content_hash" | "workspace_id"> & { body_chars: number };

function coerceSource(value: string): JobPostingSource {
  return isJobPostingSource(value) ? value : "paste";
}

function fromRow(row: PostingRow): JobPosting {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    source: coerceSource(row.source),
    sourceRef: row.source_ref,
    title: row.title,
    company: row.company,
    roleFamily: row.role_family,
    seniority: row.seniority,
    lang: row.lang,
    bodyText: row.body_text,
    contentHash: row.content_hash,
    fetchedAt: row.fetched_at,
    createdAt: row.created_at,
  };
}

function fromSummaryRow(row: SummaryRow): JobPostingSummary {
  return {
    id: row.id,
    source: coerceSource(row.source),
    sourceRef: row.source_ref,
    title: row.title,
    company: row.company,
    roleFamily: row.role_family,
    seniority: row.seniority,
    lang: row.lang,
    fetchedAt: row.fetched_at,
    createdAt: row.created_at,
    bodyChars: row.body_chars,
  };
}

/** The text the content hash is taken over. Whitespace and case are NOT content: the
 *  same advertisement pasted from a PDF and fetched from the careers page differs in
 *  both, and importing it twice must still be one row. */
export function normalizeBody(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function postingContentHash(bodyText: string): string {
  return createHash("sha256").update(normalizeBody(bodyText), "utf8").digest("hex");
}

/** Title key for the "one posting per role" sample — case, punctuation and the
 *  seniority/location decorations recruiters bolt on ("Senior Java Developer (m/f/d)")
 *  are not what makes two rows the same role. */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9À-ɏ ]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const SUMMARY_COLUMNS = `id, source, source_ref, title, company, role_family, seniority, lang,
     fetched_at, created_at, LENGTH(body_text) AS body_chars`;

/** The workspace's posting ledger, newest first. `q` matches title or company
 *  case-insensitively. */
export function listJobPostings(
  workspaceId: string = DEFAULT_WORKSPACE_ID,
  options: { q?: string; roleFamily?: string; limit?: number } = {}
): JobPostingSummary[] {
  const limit = Math.max(1, Math.min(500, Math.trunc(options.limit ?? 200) || 200));
  const q = options.q?.trim();
  const roleFamily = options.roleFamily?.trim();
  // The tenant predicate is LITERAL in the SQL below, never assembled into `clauses`:
  // a workspace filter that only exists in an interpolated fragment is invisible to the
  // source guard that proves this table is scoped (job-postings-tenancy.test.ts), and a
  // guard that cannot see the scoping is not a guard.
  const clauses: string[] = [];
  const args: (string | number)[] = [workspaceId];
  if (q) {
    // LIKE is case-insensitive for ASCII in SQLite; LOWER() on both sides extends that
    // to the accented Czech titles this corpus is full of.
    clauses.push("(LOWER(title) LIKE ? OR LOWER(IFNULL(company, '')) LIKE ?)");
    const like = `%${q.toLowerCase()}%`;
    args.push(like, like);
  }
  if (roleFamily) {
    clauses.push("role_family = ?");
    args.push(roleFamily);
  }
  args.push(limit);
  const rows = ensureDb()
    .prepare(
      `SELECT ${SUMMARY_COLUMNS} FROM job_postings
       WHERE workspace_id = ? ${clauses.map((c) => `AND ${c}`).join(" ")}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    )
    .all(...args) as SummaryRow[];
  return rows.map(fromSummaryRow);
}

/** Point read — workspace-scoped with NO by-id exemption: a leaked posting id must not
 *  resolve another team's imported material. */
export function getJobPosting(id: string, workspaceId: string = DEFAULT_WORKSPACE_ID): JobPosting | null {
  const row = ensureDb()
    .prepare(`SELECT * FROM job_postings WHERE id = ? AND workspace_id = ?`)
    .get(id, workspaceId) as PostingRow | undefined;
  return row ? fromRow(row) : null;
}

/** The ledger projection of a posting already in hand — the shape the list route
 *  returns, so a single-import response and a list response are the same type. */
export function jobPostingSummary(posting: JobPosting): JobPostingSummary {
  return {
    id: posting.id,
    source: posting.source,
    sourceRef: posting.sourceRef,
    title: posting.title,
    company: posting.company,
    roleFamily: posting.roleFamily,
    seniority: posting.seniority,
    lang: posting.lang,
    fetchedAt: posting.fetchedAt,
    createdAt: posting.createdAt,
    bodyChars: posting.bodyText.length,
  };
}

export type JobPostingInput = {
  source: JobPostingSource;
  sourceRef?: string | null;
  title: string;
  company?: string | null;
  roleFamily?: string | null;
  seniority?: string | null;
  lang?: string | null;
  bodyText: string;
  fetchedAt?: string | null;
};

/** Insert one posting, de-duplicated by (content_hash, workspace_id). A body this
 *  workspace already holds returns `{ inserted: false }` with the EXISTING id — the
 *  caller can still link to the row, which is why this is not a silent no-op. */
export function insertJobPosting(
  input: JobPostingInput,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): { id: string; inserted: boolean } {
  const d = ensureDb();
  const bodyText = input.bodyText.trim();
  const contentHash = postingContentHash(bodyText);
  const id = randomId("post");
  const res = d
    .prepare(
      `INSERT INTO job_postings
         (id, workspace_id, source, source_ref, title, company, role_family, seniority, lang,
          body_text, content_hash, fetched_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (content_hash, workspace_id) DO NOTHING`
    )
    .run(
      id,
      workspaceId,
      input.source,
      input.sourceRef?.trim() ? input.sourceRef.trim().slice(0, 500) : null,
      input.title.trim().slice(0, 300) || "Untitled posting",
      input.company?.trim() ? input.company.trim().slice(0, 200) : null,
      input.roleFamily?.trim() ? input.roleFamily.trim().slice(0, 80) : null,
      input.seniority?.trim() ? input.seniority.trim().slice(0, 80) : null,
      input.lang?.trim() ? input.lang.trim().slice(0, 16) : null,
      bodyText,
      contentHash,
      input.fetchedAt ?? null,
      new Date().toISOString()
    );
  if (res.changes > 0) return { id, inserted: true };
  const existing = d
    .prepare(`SELECT id FROM job_postings WHERE content_hash = ? AND workspace_id = ?`)
    .get(contentHash, workspaceId) as { id: string } | undefined;
  return { id: existing?.id ?? id, inserted: false };
}

/** A STRATIFIED sample: one posting per (role_family, normalized title), taken
 *  round-robin across the families so `n = 50` over a corpus dominated by one family
 *  still spans the taxonomy instead of returning fifty flavours of "developer".
 *  Fully deterministic — the SQL order and the round-robin are both total. */
export function distinctRolePostings(workspaceId: string = DEFAULT_WORKSPACE_ID, n: number): JobPosting[] {
  const want = Math.max(0, Math.trunc(n) || 0);
  if (want === 0) return [];
  const rows = ensureDb()
    .prepare(
      `SELECT * FROM job_postings WHERE workspace_id = ?
       ORDER BY IFNULL(role_family, '~') ASC, title ASC, id ASC`
    )
    .all(workspaceId) as PostingRow[];

  const byFamily = new Map<string, JobPosting[]>();
  const seenTitles = new Set<string>();
  for (const row of rows) {
    const key = normalizeTitle(row.title);
    const family = row.role_family ?? "~unknown";
    // Dedupe on the TITLE alone, not on (family, title): the same role is filed under
    // different families by the two corpora, and a sample with "Data Analyst" twice is
    // exactly what this function exists to avoid.
    if (key && seenTitles.has(key)) continue;
    if (key) seenTitles.add(key);
    const bucket = byFamily.get(family);
    if (bucket) bucket.push(fromRow(row));
    else byFamily.set(family, [fromRow(row)]);
  }

  const families = [...byFamily.keys()].sort();
  const out: JobPosting[] = [];
  for (let round = 0; out.length < want; round += 1) {
    let advanced = false;
    for (const family of families) {
      const bucket = byFamily.get(family)!;
      if (round >= bucket.length) continue;
      advanced = true;
      out.push(bucket[round]);
      if (out.length === want) break;
    }
    if (!advanced) break; // every family exhausted — the corpus is smaller than `n`
  }
  return out;
}

// ---- the one-shot corpus import -------------------------------------------

/** Seed-mark name. Per WORKSPACE: the corpus is imported per team, so "already ran" is
 *  a fact about (database, workspace), not about the database alone — a second team
 *  importing the corpus is a first run, not a replay. */
export function corpusSeedMark(workspaceId: string): string {
  return `job_postings_corpus_v1:${workspaceId}`;
}

type CalibrationRecord = {
  id?: string;
  title?: string;
  company?: string;
  jd_text?: string;
  role_family?: string;
  seniority?: string;
};

type SeedJobRecord = {
  id?: string;
  title?: string;
  company?: string;
  description?: string;
  requirements?: string[];
  role_family?: string;
  seniority?: string;
  languages?: string[];
};

const CALIBRATION_PATH = path.join(process.cwd(), "data", "seed_calibration", "jobs.json");
const SEED_JOBS_PATH = path.join(process.cwd(), "data", "seed_jobs", "jobs.json");

function readCorpus<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch (error) {
    // A malformed corpus file is an operator-visible fact, not a boot failure: the
    // import returns 0 and says so through the counts, and the mark is NOT stamped
    // below when nothing was read, so a fixed file still imports on the next call.
    console.error(`[job-postings] could not read the posting corpus at ${file}:`, error);
    return [];
  }
}

/** Body for a seed_jobs record: the advertisement as a candidate would read it —
 *  description followed by the requirement bullets. */
export function seedJobBody(job: SeedJobRecord): string {
  const description = (job.description ?? "").trim();
  const requirements = (job.requirements ?? []).filter((r) => typeof r === "string" && r.trim());
  if (requirements.length === 0) return description;
  return `${description}\n\nRequirements:\n- ${requirements.join("\n- ")}`;
}

/** Import the two bundled corpora into this workspace, ONCE. Guarded by a seed mark
 *  (never `COUNT(*) > 0`): a team that imported the corpus and then deliberately
 *  cleared it must not have it injected back on the next call. */
export function seedJobPostingsCorpus(workspaceId: string = DEFAULT_WORKSPACE_ID): {
  inserted: number;
  skipped: number;
} {
  const d = ensureDb();
  const mark = corpusSeedMark(workspaceId);
  if (seedAlreadyRan(d, mark)) return { inserted: 0, skipped: 0 };

  const calibration = readCorpus<CalibrationRecord>(CALIBRATION_PATH);
  const seedJobs = readCorpus<SeedJobRecord>(SEED_JOBS_PATH);

  let inserted = 0;
  let skipped = 0;
  const add = (input: JobPostingInput) => {
    if (input.bodyText.trim().length === 0 || !input.title.trim()) {
      skipped += 1;
      return;
    }
    // NOT inside a db.transaction(): insertJobPosting reads back the colliding row on
    // conflict, and wrapping a few hundred synchronous inserts buys nothing an
    // operator would notice while making the dedupe read part of a write lock.
    if (insertJobPosting(input, workspaceId).inserted) inserted += 1;
    else skipped += 1;
  };

  for (const job of calibration) {
    add({
      source: "seed_calibration",
      sourceRef: job.id ?? null,
      title: job.title ?? "",
      company: job.company ?? null,
      roleFamily: job.role_family ?? null,
      seniority: job.seniority ?? null,
      // The calibration corpus is English real-world bodies (data/seed_calibration).
      lang: "en",
      bodyText: job.jd_text ?? "",
    });
  }
  for (const job of seedJobs) {
    add({
      source: "seed_jobs",
      sourceRef: job.id ?? null,
      title: job.title ?? "",
      company: job.company ?? null,
      roleFamily: job.role_family ?? null,
      seniority: job.seniority ?? null,
      lang: job.languages?.[0] ?? "cs",
      bodyText: seedJobBody(job),
    });
  }

  // Only a run that actually READ a corpus is a completed import — a missing or
  // unparseable file leaves the mark unset so a fixed checkout still seeds.
  if (calibration.length > 0 || seedJobs.length > 0) markSeedRan(d, mark);
  return { inserted, skipped };
}
