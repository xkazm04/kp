import path from "node:path";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import Database from "better-sqlite3";

const DB_PATH = process.env.KP_DB_PATH ?? path.join(process.cwd(), "data", "kp.sqlite");

let _db: Database.Database | null = null;

// ---- Seed health (boot diagnostics) ---------------------------------------
// A corrupt or absent seed file used to leave a table silently empty while
// ensureDb() still completed and cached _db, so Jobs/Match/recruiter views all
// rendered empty with no error, log, or signal — a one-character JSON typo
// became an hours-long "why is everything empty" hunt. We now record every
// seed read/parse failure with its path + reason so an empty catalog is
// diagnosable. Consumers can read getSeedHealth() or surface it on first request.

export type SeedIssue = {
  seed: "jobs" | "candidates" | "pipeline";
  path: string;
  reason: string;
  severity: "missing" | "error";
};

const seedIssues: SeedIssue[] = [];

function recordSeedIssue(issue: SeedIssue): void {
  seedIssues.push(issue);
  const what = issue.severity === "missing" ? "seed file not found" : "failed to read/parse seed";
  const line = `[seed:${issue.seed}] ${what} at ${issue.path} — ${issue.reason}`;
  if (issue.severity === "error") {
    console.error(line);
  } else {
    console.warn(line);
  }
}

export type SeedHealth = { ok: boolean; issues: SeedIssue[] };

/** Boot health flag: ok=false when any seed hit a hard read/parse error. */
export function getSeedHealth(): SeedHealth {
  ensureDb(); // make sure seeding has run before reporting
  return { ok: seedIssues.every((i) => i.severity !== "error"), issues: [...seedIssues] };
}

/**
 * Parse a JSON column from a DB row without letting one corrupt row throw the
 * whole read. A single poisoned payload used to 500 an entire list endpoint
 * (and, for seeds, wedge ensureDb so every request re-threw). We now log the
 * offending row + context and return null so callers degrade to N-1.
 */
function safeRowParse<T>(json: string | null | undefined, ctx: string, id?: string): T | null {
  if (json == null) return null;
  try {
    return JSON.parse(json) as T;
  } catch (error) {
    console.error(`[db:${ctx}] corrupt JSON for row ${id ?? "?"} — ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** Tasks still in flight, for the readiness probe. */
export function countActiveTasks(): { running: number; queued: number } {
  const db = ensureDb();
  const running = (db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE status='running'`).get() as { n: number }).n;
  const queued = (db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE status='queued'`).get() as { n: number }).n;
  return { running, queued };
}

/** Row counts for core tables, for the readiness probe. Table names are a fixed allow-list. */
export function coreTableCounts(): Record<string, number> {
  const db = ensureDb();
  const out: Record<string, number> = {};
  for (const t of ["jobs", "profiles", "pipeline_entries", "analyses", "tasks"]) {
    out[t] = (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  }
  return out;
}

function ensureDb(): Database.Database {
  if (_db) return _db;
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS analyses (
      slug TEXT PRIMARY KEY,
      candidate_label TEXT NOT NULL,
      jd_slug TEXT,
      score INTEGER,
      role_family TEXT,
      seniority TEXT,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_analyses_created_at
      ON analyses (created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_analyses_jd_slug
      ON analyses (jd_slug);

    CREATE TABLE IF NOT EXISTS jds (
      slug TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_jds_created_at
      ON jds (created_at DESC);

    CREATE TABLE IF NOT EXISTS gemini_cache (
      hash TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_gemini_cache_expires
      ON gemini_cache (expires_at);

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      company TEXT,
      location TEXT,
      work_mode TEXT,
      seniority TEXT,
      role_family TEXT,
      employment_type TEXT,
      min_years REAL,
      min_education TEXT,
      languages TEXT,
      is_entry_eligible INTEGER DEFAULT 0,
      graduate_friendliness REAL DEFAULT 0,
      salary_min INTEGER,
      salary_max INTEGER,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_role_family ON jobs (role_family);
    CREATE INDEX IF NOT EXISTS idx_jobs_seniority ON jobs (seniority);
    CREATE INDEX IF NOT EXISTS idx_jobs_work_mode ON jobs (work_mode);
    CREATE INDEX IF NOT EXISTS idx_jobs_entry ON jobs (is_entry_eligible);

    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      archetype TEXT,
      role_family TEXT,
      completeness REAL DEFAULT 0,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_profiles_created_at ON profiles (created_at DESC);

    CREATE TABLE IF NOT EXISTS pipeline_entries (
      id TEXT PRIMARY KEY,
      candidate_id TEXT,
      candidate_label TEXT NOT NULL,
      archetype TEXT,
      role_family TEXT,
      job_id TEXT,
      job_title TEXT,
      stage TEXT NOT NULL,
      match_score INTEGER,
      status TEXT NOT NULL DEFAULT 'active',
      approval_kind TEXT,
      approval_detail TEXT,
      created_at TEXT,
      stage_changed_at TEXT,
      updated_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_pipeline_job ON pipeline_entries (job_id);
    CREATE INDEX IF NOT EXISTS idx_pipeline_stage ON pipeline_entries (stage);

    CREATE TABLE IF NOT EXISTS pipeline_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id TEXT,
      candidate_label TEXT,
      job_title TEXT,
      archetype TEXT,
      kind TEXT NOT NULL,
      from_stage TEXT,
      to_stage TEXT,
      detail TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_pipeline_events_created ON pipeline_events (created_at DESC);

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      dedupe_key TEXT,
      label TEXT,
      status TEXT NOT NULL,
      params_json TEXT,
      result_json TEXT,
      error TEXT,
      progress_done INTEGER DEFAULT 0,
      progress_total INTEGER DEFAULT 0,
      progress_msg TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_dedupe ON tasks (dedupe_key, status);
    CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks (created_at DESC);

    CREATE TABLE IF NOT EXISTS dev_cases (
      id TEXT PRIMARY KEY,
      title TEXT,
      role_title TEXT,
      seniority TEXT,
      need_json TEXT,
      analysis_json TEXT,
      role_json TEXT,
      case_json TEXT,
      status TEXT NOT NULL DEFAULT 'approved',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_dev_cases_created ON dev_cases (created_at DESC);

    CREATE TABLE IF NOT EXISTS dev_postings (
      id TEXT PRIMARY KEY,
      case_id TEXT,
      channel TEXT NOT NULL,
      token TEXT,
      role_title TEXT,
      case_title TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dev_submissions (
      id TEXT PRIMARY KEY,
      posting_id TEXT,
      candidate_ref TEXT,
      repo_ref TEXT,
      notes TEXT,
      contact TEXT,
      status TEXT NOT NULL DEFAULT 'received',
      eval_json TEXT,
      transfer_score INTEGER,
      received_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dev_outbox (
      id TEXT PRIMARY KEY,
      recipient TEXT,
      subject TEXT,
      body TEXT,
      kind TEXT,
      channel TEXT,
      status TEXT NOT NULL,
      ref TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_dev_outbox_created ON dev_outbox (created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_dev_postings_created ON dev_postings (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_dev_submissions_posting ON dev_submissions (posting_id);

    CREATE TABLE IF NOT EXISTS dev_lifecycle (
      id TEXT PRIMARY KEY,
      title TEXT,
      stage TEXT NOT NULL,
      auto INTEGER DEFAULT 1,
      need_json TEXT,
      analysis_json TEXT,
      role_json TEXT,
      case_json TEXT,
      case_id TEXT,
      posting_id TEXT,
      detail TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_dev_lifecycle_created ON dev_lifecycle (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_dev_lifecycle_posting ON dev_lifecycle (posting_id);
  `);
  // Migration for DBs created before the observability columns existed.
  for (const col of ["created_at", "stage_changed_at"]) {
    try {
      db.exec(`ALTER TABLE pipeline_entries ADD COLUMN ${col} TEXT`);
    } catch {
      /* column already exists */
    }
  }
  // Migration for dev_submissions evaluation + contact columns (Phase D6 / B).
  for (const sql of [
    "ALTER TABLE dev_submissions ADD COLUMN eval_json TEXT",
    "ALTER TABLE dev_submissions ADD COLUMN transfer_score INTEGER",
    "ALTER TABLE dev_submissions ADD COLUMN contact TEXT",
  ]) {
    try {
      db.exec(sql);
    } catch {
      /* column already exists */
    }
  }
  // Atomic dedup: a (posting, candidate, repo) triple is unique, so two
  // concurrent submits can't both INSERT (double-click / webhook retry storm).
  // Guarded: a legacy DB may already hold duplicate triples that block the
  // index — in that case we leave the rows and fall back to app-level coalescing.
  try {
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_dev_submissions_dedup
         ON dev_submissions (posting_id, candidate_ref, repo_ref)`
    );
  } catch {
    /* pre-existing duplicate rows prevent the unique index; skip */
  }
  seedExampleJd(db);
  seedJobs(db);
  seedCandidates(db);
  seedPipeline(db);
  _db = db;
  return db;
}

// Drop a single example JD into the library on first init so the picker is
// not empty when a developer first opens the app. Idempotent: skipped on
// every subsequent boot.
const SEED_JD_SLUG = "example-ai-architect";
const SEED_JD_TITLE = "AI Architect / ML Engineer (part-time → core team) — K&P AI";
const SEED_JD_BODY = `Company: K&P AI s.r.o.
Role: AI Architect / ML Engineer (part-time → core team)
Location: Remote-friendly; Prague-based company
Employment: Part-time, ~10 hours/week; flexible start
Compensation: 10,000 CZK monthly initially + equity; progression to Head of AI

About the company
SaaS startup building AI tools that simplify data work and decision-making. Practical products addressing real problems — speed, clarity, usability over aesthetics. €250k+ investment, Web Summit selection. Core team of 5 spans web, product, marketing, development, and AI. A B2C AI architecture is already in place; you advance it further.

Key responsibilities
- Build on the existing B2C AI architecture
- Adapt and enhance the architecture for B2B use cases
- Refine B2C systems using production data
- Design and iterate AI pipelines (scoring, LLM, evaluation)
- Execute prompt engineering and improve output explainability
- Handle data tasks: scraping, structuring, validation
- Establish quality metrics and testing frameworks

Required skills
- AI / ML experience on real projects (not toy / coursework only)
- Understanding of AI architecture and end-to-end pipelines
- Python proficiency for data integration
- Foundation in embeddings, LLMs, and pipeline composition
- Product and business thinking
- Self-directed, ownership mindset
- Enjoyment of technical problem-solving

Nice to have
- Aspiration to lead AI / analytics teams in the future

Seniority: Mid-level to Senior
Growth path: potential advancement to Head of AI with team-building scope and international scaling.

Source: https://www.startupjobs.cz/nabidka/103717/ai-architect-ml-engineer-part-time-core-team`;

function seedExampleJd(db: Database.Database): void {
  const row = db.prepare(`SELECT 1 FROM jds WHERE slug = ?`).get(SEED_JD_SLUG);
  if (row) return;
  db.prepare(`INSERT INTO jds (slug, title, body, created_at) VALUES (?, ?, ?, ?)`).run(
    SEED_JD_SLUG,
    SEED_JD_TITLE,
    SEED_JD_BODY,
    new Date().toISOString()
  );
}

export type AnalysisRow = {
  slug: string;
  candidate_label: string;
  jd_slug: string | null;
  score: number | null;
  role_family: string | null;
  seniority: string | null;
  payload_json: string;
  created_at: string;
};

export type AnalysisSummary = Omit<AnalysisRow, "payload_json">;

export type JdRow = {
  slug: string;
  title: string;
  body: string;
  created_at: string;
};

// What the list endpoint exposes: identity + a short, server-truncated preview
// instead of the full body, so the list response stays bounded no matter how
// large individual JD bodies grow. Full bodies remain behind loadJd /
// GET /api/jds/[slug].
export type JdListItem = {
  slug: string;
  title: string;
  preview: string;
  created_at: string;
};

const JD_PREVIEW_CHARS = 280;

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
function generateSlug(): string {
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  return (
    /UNIQUE constraint failed/i.test(error.message) ||
    (typeof code === "string" && code.startsWith("SQLITE_CONSTRAINT"))
  );
}

const SLUG_RETRY_ATTEMPTS = 5;

/**
 * Insert a row keyed by a random slug, regenerating the slug and retrying on a
 * UNIQUE collision (bounded). The 8-char slug space makes a single collision
 * unlikely, but it grows with the table; this makes the whole class of
 * "UNIQUE constraint failed" 500s effectively impossible across slug-backed
 * tables. `insert` must perform a plain INSERT that throws on collision.
 */
function insertWithUniqueSlug(insert: (slug: string) => void): string {
  for (let attempt = 0; attempt < SLUG_RETRY_ATTEMPTS; attempt++) {
    const slug = generateSlug();
    try {
      insert(slug);
      return slug;
    } catch (error) {
      if (isUniqueViolation(error) && attempt < SLUG_RETRY_ATTEMPTS - 1) continue;
      throw error;
    }
  }
  // Unreachable: the loop above either returns a slug or throws.
  throw new Error("Could not generate a unique slug.");
}

export type SaveAnalysisInput = {
  candidateLabel: string;
  jdSlug: string | null;
  score: number | null;
  roleFamily: string | null;
  seniority: string | null;
  payload: unknown;
};

export function saveAnalysis(input: SaveAnalysisInput): { slug: string; createdAt: string } {
  const db = ensureDb();
  const createdAt = new Date().toISOString();
  const payloadJson = JSON.stringify(input.payload);
  const stmt = db.prepare(
    `INSERT INTO analyses
      (slug, candidate_label, jd_slug, score, role_family, seniority, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const slug = insertWithUniqueSlug((s) =>
    stmt.run(
      s,
      input.candidateLabel,
      input.jdSlug,
      input.score,
      input.roleFamily,
      input.seniority,
      payloadJson,
      createdAt
    )
  );
  return { slug, createdAt };
}

export function listAnalyses(limit = 100): AnalysisSummary[] {
  const db = ensureDb();
  const rows = db
    .prepare(
      `SELECT slug, candidate_label, jd_slug, score, role_family, seniority, created_at
       FROM analyses
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(limit) as AnalysisSummary[];
  return rows;
}

// Every analysis tagged with a JD slug, ordered best-score-first. Uses the
// idx_analyses_jd_slug index — no row cap and no in-memory filter, so the JD
// page's candidate count stays correct even past 500 total analyses.
export function listAnalysesByJd(slug: string): AnalysisSummary[] {
  const db = ensureDb();
  return db
    .prepare(
      `SELECT slug, candidate_label, jd_slug, score, role_family, seniority, created_at
       FROM analyses
       WHERE jd_slug = ?
       ORDER BY score DESC, created_at DESC`
    )
    .all(slug) as AnalysisSummary[];
}

export function loadAnalysis(slug: string): { row: AnalysisRow; payload: unknown } | null {
  const db = ensureDb();
  const row = db
    .prepare(
      `SELECT slug, candidate_label, jd_slug, score, role_family, seniority, payload_json, created_at
       FROM analyses WHERE slug = ?`
    )
    .get(slug) as AnalysisRow | undefined;
  if (!row) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(row.payload_json);
  } catch {
    return null;
  }
  return { row, payload };
}

export type SaveJdInput = {
  title: string;
  body: string;
};

export function saveJd(input: SaveJdInput): { slug: string; createdAt: string } {
  const db = ensureDb();
  const createdAt = new Date().toISOString();
  const stmt = db.prepare(`INSERT INTO jds (slug, title, body, created_at) VALUES (?, ?, ?, ?)`);
  const slug = insertWithUniqueSlug((s) => stmt.run(s, input.title, input.body, createdAt));
  return { slug, createdAt };
}

export function listJds(limit = 100): JdListItem[] {
  const db = ensureDb();
  // Pull only one char past the preview window to detect truncation, so the
  // full body is never read into memory for the list view.
  const rows = db
    .prepare(
      `SELECT slug, title, created_at,
              substr(body, 1, ${JD_PREVIEW_CHARS + 1}) AS body_head,
              length(body) AS body_len
       FROM jds ORDER BY created_at DESC LIMIT ?`
    )
    .all(limit) as Array<{
    slug: string;
    title: string;
    created_at: string;
    body_head: string;
    body_len: number;
  }>;
  return rows.map((r) => ({
    slug: r.slug,
    title: r.title,
    created_at: r.created_at,
    preview: r.body_len > JD_PREVIEW_CHARS ? `${r.body_head.slice(0, JD_PREVIEW_CHARS)}…` : r.body_head,
  }));
}

export function loadJd(slug: string): JdRow | null {
  const db = ensureDb();
  const row = db
    .prepare(`SELECT slug, title, body, created_at FROM jds WHERE slug = ?`)
    .get(slug) as JdRow | undefined;
  return row ?? null;
}

type CacheRow = {
  hash: string;
  payload_json: string;
  prompt_version: string;
  expires_at: string;
};

export function lookupGeminiCache(hash: string, promptVersion: string): unknown | null {
  const db = ensureDb();
  const row = db
    .prepare(
      `SELECT hash, payload_json, prompt_version, expires_at
       FROM gemini_cache WHERE hash = ?`
    )
    .get(hash) as CacheRow | undefined;
  if (!row) return null;
  if (row.prompt_version !== promptVersion) return null;
  const expiresAt = Date.parse(row.expires_at);
  if (Number.isFinite(expiresAt) && expiresAt < Date.now()) return null;
  try {
    return JSON.parse(row.payload_json);
  } catch {
    return null;
  }
}

export function storeGeminiCache(
  hash: string,
  payload: unknown,
  promptVersion: string,
  ttlHours: number
): void {
  const db = ensureDb();
  const now = new Date();
  const expires = new Date(now.getTime() + ttlHours * 3600 * 1000);
  db.prepare(
    `INSERT INTO gemini_cache (hash, payload_json, prompt_version, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(hash) DO UPDATE SET
       payload_json = excluded.payload_json,
       prompt_version = excluded.prompt_version,
       created_at = excluded.created_at,
       expires_at = excluded.expires_at`
  ).run(hash, JSON.stringify(payload), promptVersion, now.toISOString(), expires.toISOString());
}

export function pruneGeminiCache(): number {
  const db = ensureDb();
  const result = db
    .prepare(`DELETE FROM gemini_cache WHERE expires_at < ?`)
    .run(new Date().toISOString());
  return Number(result.changes ?? 0);
}

// ---- Jobs (v2 matching platform) ------------------------------------------
// The store holds fully-normalized jobs (resolved taxonomy terms, salary anchor
// band, graduate lens) produced by the Python pipeline, so TypeScript never
// re-implements that logic. Seeded from the committed synthetic corpus on first
// boot; later ingestion will INSERT individual jobs through the same table.

export type JobRequirementRecord = {
  skill: string;
  termId?: string | null;
  kind: string;
  hardness: string;
};

export type JobEntryProfileRecord = {
  isEntryEligible: boolean;
  graduateFriendliness: number;
  reinterpretedMusts: string[];
  trainableGaps: string[];
  rationale?: string;
};

export type JobRecord = {
  id: string;
  title: string;
  company?: string;
  location?: string;
  workMode?: string;
  employmentType?: string | null;
  seniority?: string;
  roleFamily?: string;
  languages?: string[];
  minYearsExperience?: number | null;
  minEducation?: string | null;
  description?: string;
  requirements?: JobRequirementRecord[];
  detectedSkills?: string[];
  salaryBand?: number[];
  entryProfile?: JobEntryProfileRecord | null;
  source?: string;
};

const SEED_JOBS_PATH = path.join(process.cwd(), "data", "seed_jobs", "jobs.normalized.json");

function seedJobs(db: Database.Database): void {
  const count = db.prepare(`SELECT COUNT(*) AS n FROM jobs`).get() as { n: number };
  if (count.n > 0) return;
  if (!existsSync(SEED_JOBS_PATH)) {
    recordSeedIssue({ seed: "jobs", path: SEED_JOBS_PATH, reason: "file does not exist", severity: "missing" });
    return;
  }
  let jobs: JobRecord[];
  try {
    jobs = JSON.parse(readFileSync(SEED_JOBS_PATH, "utf-8")) as JobRecord[];
  } catch (error) {
    recordSeedIssue({
      seed: "jobs",
      path: SEED_JOBS_PATH,
      reason: error instanceof Error ? error.message : String(error),
      severity: "error",
    });
    return;
  }
  if (!Array.isArray(jobs)) {
    recordSeedIssue({ seed: "jobs", path: SEED_JOBS_PATH, reason: "seed JSON is not an array", severity: "error" });
    return;
  }
  const now = new Date().toISOString();
  const insert = db.prepare(`INSERT OR IGNORE INTO jobs
      (id, title, company, location, work_mode, seniority, role_family, employment_type,
       min_years, min_education, languages, is_entry_eligible, graduate_friendliness,
       salary_min, salary_max, payload_json, created_at)
     VALUES (@id, @title, @company, @location, @work_mode, @seniority, @role_family, @employment_type,
       @min_years, @min_education, @languages, @is_entry_eligible, @graduate_friendliness,
       @salary_min, @salary_max, @payload_json, @created_at)`);
  const tx = db.transaction((rows: JobRecord[]) => {
    for (const job of rows) {
      if (!job?.id || !job?.title) continue;
      insert.run({
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
        created_at: now,
      });
    }
  });
  tx(jobs);
}

export type JobFilter = {
  roleFamily?: string;
  seniority?: string;
  workMode?: string;
  entryEligible?: boolean;
  q?: string;
  limit?: number;
};

export function listJobs(filter: JobFilter = {}): JobRecord[] {
  const db = ensureDb();
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (filter.roleFamily) {
    where.push("role_family = @roleFamily");
    params.roleFamily = filter.roleFamily;
  }
  if (filter.seniority) {
    where.push("seniority = @seniority");
    params.seniority = filter.seniority;
  }
  if (filter.workMode) {
    where.push("work_mode = @workMode");
    params.workMode = filter.workMode;
  }
  if (filter.entryEligible !== undefined) {
    where.push("is_entry_eligible = @entry");
    params.entry = filter.entryEligible ? 1 : 0;
  }
  if (filter.q) {
    where.push("(title LIKE @q OR company LIKE @q)");
    params.q = `%${filter.q}%`;
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  // Defensive clamp: never bind a NaN/negative/huge LIMIT even if a caller
  // skips validation. SQLite treats LIMIT -1 as unbounded, so guard the floor.
  params.limit =
    Number.isInteger(filter.limit) && (filter.limit as number) > 0
      ? Math.min(filter.limit as number, 500)
      : 300;
  const rows = db
    .prepare(
      `SELECT payload_json FROM jobs ${clause}
       ORDER BY is_entry_eligible DESC, graduate_friendliness DESC, id LIMIT @limit`
    )
    .all(params) as { payload_json: string }[];
  return rows
    .map((r) => safeRowParse<JobRecord>(r.payload_json, "listJobs"))
    .filter((j): j is JobRecord => j !== null);
}

export function getJob(id: string): JobRecord | null {
  const db = ensureDb();
  const row = db.prepare(`SELECT payload_json FROM jobs WHERE id = ?`).get(id) as
    | { payload_json: string }
    | undefined;
  return row ? safeRowParse<JobRecord>(row.payload_json, "getJob", id) : null;
}

export type JobStats = {
  total: number;
  entryEligible: number;
  byRoleFamily: Record<string, number>;
  bySeniority: Record<string, number>;
  byWorkMode: Record<string, number>;
};

export function jobStats(): JobStats {
  const db = ensureDb();
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM jobs`).get() as { n: number }).n;
  const entryEligible = (
    db.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE is_entry_eligible = 1`).get() as { n: number }
  ).n;
  // Column names are fixed literals (not user input) — safe to interpolate.
  const group = (col: "role_family" | "seniority" | "work_mode"): Record<string, number> => {
    const rows = db
      .prepare(`SELECT ${col} AS k, COUNT(*) AS n FROM jobs GROUP BY ${col} ORDER BY n DESC`)
      .all() as { k: string | null; n: number }[];
    return Object.fromEntries(rows.map((r) => [r.k ?? "—", r.n]));
  };
  return {
    total,
    entryEligible,
    byRoleFamily: group("role_family"),
    bySeniority: group("seniority"),
    byWorkMode: group("work_mode"),
  };
}

// ---- Candidate profiles (v2 archetype-aware intake) -----------------------

export type ProfileRow = {
  id: string;
  label: string;
  archetype: string | null;
  role_family: string | null;
  completeness: number | null;
  created_at: string;
};

export type SaveProfileInput = {
  label: string;
  archetype: string | null;
  roleFamily: string | null;
  completeness: number | null;
  payload: unknown;
};

export function saveProfile(input: SaveProfileInput): { id: string; createdAt: string } {
  const db = ensureDb();
  const createdAt = new Date().toISOString();
  const payloadJson = JSON.stringify(input.payload);
  const stmt = db.prepare(
    `INSERT INTO profiles (id, label, archetype, role_family, completeness, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const id = insertWithUniqueSlug((s) =>
    stmt.run(s, input.label, input.archetype, input.roleFamily, input.completeness, payloadJson, createdAt)
  );
  return { id, createdAt };
}

export function listProfiles(limit = 100): ProfileRow[] {
  const db = ensureDb();
  return db
    .prepare(
      `SELECT id, label, archetype, role_family, completeness, created_at
       FROM profiles ORDER BY created_at DESC LIMIT ?`
    )
    .all(limit) as ProfileRow[];
}

export function getProfileRecord(id: string): { row: ProfileRow; payload: unknown } | null {
  const db = ensureDb();
  const row = db
    .prepare(
      `SELECT id, label, archetype, role_family, completeness, payload_json, created_at
       FROM profiles WHERE id = ?`
    )
    .get(id) as (ProfileRow & { payload_json: string }) | undefined;
  if (!row) return null;
  try {
    const { payload_json, ...rest } = row;
    return { row: rest, payload: JSON.parse(payload_json) };
  } catch {
    return null;
  }
}

// Seed the synthetic candidate population into `profiles` on first boot, so
// Profile / Match / Pipeline show an enterprise-like load.
const SEED_CANDIDATES_PATH = path.join(process.cwd(), "data", "seed_candidates", "candidates.json");

function seedCandidates(db: Database.Database): void {
  const count = db.prepare(`SELECT COUNT(*) AS n FROM profiles`).get() as { n: number };
  if (count.n > 0) return;
  if (!existsSync(SEED_CANDIDATES_PATH)) {
    recordSeedIssue({ seed: "candidates", path: SEED_CANDIDATES_PATH, reason: "file does not exist", severity: "missing" });
    return;
  }
  let records: Array<Record<string, unknown>>;
  try {
    records = JSON.parse(readFileSync(SEED_CANDIDATES_PATH, "utf-8"));
  } catch (error) {
    recordSeedIssue({
      seed: "candidates",
      path: SEED_CANDIDATES_PATH,
      reason: error instanceof Error ? error.message : String(error),
      severity: "error",
    });
    return;
  }
  if (!Array.isArray(records)) {
    recordSeedIssue({ seed: "candidates", path: SEED_CANDIDATES_PATH, reason: "seed JSON is not an array", severity: "error" });
    return;
  }
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO profiles (id, label, archetype, role_family, completeness, payload_json, created_at)
     VALUES (@id, @label, @archetype, @role_family, @completeness, @payload_json, @created_at)`
  );
  const tx = db.transaction((rows: Array<Record<string, unknown>>) => {
    for (const rec of rows) {
      const id = rec.id as string;
      if (!id) continue;
      insert.run({
        id,
        label: (rec.displayName as string) || id,
        archetype: (rec.archetype as string) ?? null,
        role_family: (rec.roleFamily as string) ?? null,
        completeness: (rec.completeness as number) ?? null,
        payload_json: JSON.stringify(rec),
        created_at: now,
      });
    }
  });
  tx(records);
}

// ---- Hiring pipeline (Phase 10) -------------------------------------------

export const PIPELINE_STAGES = ["Sourced", "AI-matched", "Screening", "Interview", "Offer", "Hired"] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export type PipelineEntry = {
  id: string;
  candidateId: string | null;
  candidateLabel: string;
  archetype: string | null;
  roleFamily: string | null;
  jobId: string | null;
  jobTitle: string | null;
  stage: string;
  matchScore: number | null;
  status: string;
  approvalKind: string | null;
  approvalDetail: string | null;
  createdAt: string | null;
  stageChangedAt: string | null;
};

export type PipelineEvent = {
  id: number;
  entryId: string | null;
  candidateLabel: string | null;
  jobTitle: string | null;
  archetype: string | null;
  kind: string;
  fromStage: string | null;
  toStage: string | null;
  detail: string | null;
  createdAt: string;
};

function recordEvent(
  db: Database.Database,
  e: {
    entryId?: string | null;
    candidateLabel?: string | null;
    jobTitle?: string | null;
    archetype?: string | null;
    kind: string;
    fromStage?: string | null;
    toStage?: string | null;
    detail?: string | null;
    createdAt?: string;
  }
): void {
  db.prepare(
    `INSERT INTO pipeline_events (entry_id, candidate_label, job_title, archetype, kind, from_stage, to_stage, detail, created_at)
     VALUES (@entry_id, @candidate_label, @job_title, @archetype, @kind, @from_stage, @to_stage, @detail, @created_at)`
  ).run({
    entry_id: e.entryId ?? null,
    candidate_label: e.candidateLabel ?? null,
    job_title: e.jobTitle ?? null,
    archetype: e.archetype ?? null,
    kind: e.kind,
    from_stage: e.fromStage ?? null,
    to_stage: e.toStage ?? null,
    detail: e.detail ?? null,
    created_at: e.createdAt ?? new Date().toISOString(),
  });
}

export function listPipelineEvents(limit = 40): PipelineEvent[] {
  const db = ensureDb();
  const rows = db
    .prepare(
      `SELECT id, entry_id, candidate_label, job_title, archetype, kind, from_stage, to_stage, detail, created_at
       FROM pipeline_events ORDER BY created_at DESC, id DESC LIMIT ?`
    )
    .all(limit) as Array<{
    id: number;
    entry_id: string | null;
    candidate_label: string | null;
    job_title: string | null;
    archetype: string | null;
    kind: string;
    from_stage: string | null;
    to_stage: string | null;
    detail: string | null;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    entryId: r.entry_id,
    candidateLabel: r.candidate_label,
    jobTitle: r.job_title,
    archetype: r.archetype,
    kind: r.kind,
    fromStage: r.from_stage,
    toStage: r.to_stage,
    detail: r.detail,
    createdAt: r.created_at,
  }));
}

const SEED_PIPELINE_PATH = path.join(process.cwd(), "data", "seed_pipeline", "pipeline.json");

function seedPipeline(db: Database.Database): void {
  const count = db.prepare(`SELECT COUNT(*) AS n FROM pipeline_entries`).get() as { n: number };
  if (count.n > 0) return;
  if (!existsSync(SEED_PIPELINE_PATH)) {
    recordSeedIssue({ seed: "pipeline", path: SEED_PIPELINE_PATH, reason: "file does not exist", severity: "missing" });
    return;
  }
  let entries: PipelineEntry[];
  try {
    entries = JSON.parse(readFileSync(SEED_PIPELINE_PATH, "utf-8"));
  } catch (error) {
    recordSeedIssue({
      seed: "pipeline",
      path: SEED_PIPELINE_PATH,
      reason: error instanceof Error ? error.message : String(error),
      severity: "error",
    });
    return;
  }
  if (!Array.isArray(entries)) {
    recordSeedIssue({ seed: "pipeline", path: SEED_PIPELINE_PATH, reason: "seed JSON is not an array", severity: "error" });
    return;
  }
  const nowMs = Date.now();
  const day = 86_400_000;
  const insert = db.prepare(
    `INSERT OR IGNORE INTO pipeline_entries
       (id, candidate_id, candidate_label, archetype, role_family, job_id, job_title,
        stage, match_score, status, approval_kind, approval_detail, created_at, stage_changed_at, updated_at)
     VALUES (@id, @candidate_id, @candidate_label, @archetype, @role_family, @job_id, @job_title,
        @stage, @match_score, @status, @approval_kind, @approval_detail, @created_at, @stage_changed_at, @updated_at)`
  );
  const tx = db.transaction((rows: PipelineEntry[]) => {
    rows.forEach((e, i) => {
      if (!e?.id) return;
      // Deterministic aging spread so SLA/aging signals vary across the demo set.
      const daysInStage = (i * 37) % 18;
      const enteredDaysAgo = daysInStage + ((i * 13) % 21);
      const stageChangedAt = new Date(nowMs - daysInStage * day).toISOString();
      const createdAt = new Date(nowMs - enteredDaysAgo * day).toISOString();
      insert.run({
        id: e.id,
        candidate_id: e.candidateId ?? null,
        candidate_label: e.candidateLabel ?? "Candidate",
        archetype: e.archetype ?? null,
        role_family: e.roleFamily ?? null,
        job_id: e.jobId ?? null,
        job_title: e.jobTitle ?? null,
        stage: e.stage ?? "Sourced",
        match_score: e.matchScore ?? null,
        status: e.status ?? "active",
        approval_kind: e.approvalKind ?? null,
        approval_detail: e.approvalDetail ?? null,
        created_at: createdAt,
        stage_changed_at: stageChangedAt,
        updated_at: stageChangedAt,
      });
      // Seed a little history so the activity feed isn't empty on first load.
      recordEvent(db, {
        entryId: e.id,
        candidateLabel: e.candidateLabel,
        jobTitle: e.jobTitle,
        archetype: e.archetype,
        kind: "matched",
        toStage: "AI-matched",
        createdAt,
      });
      if (e.stage !== "Sourced" && e.stage !== "AI-matched") {
        recordEvent(db, {
          entryId: e.id,
          candidateLabel: e.candidateLabel,
          jobTitle: e.jobTitle,
          archetype: e.archetype,
          kind: "advanced",
          toStage: e.stage,
          createdAt: stageChangedAt,
        });
      }
    });
  });
  tx(entries);
}

type PipelineRow = {
  id: string;
  candidate_id: string | null;
  candidate_label: string;
  archetype: string | null;
  role_family: string | null;
  job_id: string | null;
  job_title: string | null;
  stage: string;
  match_score: number | null;
  status: string;
  approval_kind: string | null;
  approval_detail: string | null;
  created_at: string | null;
  stage_changed_at: string | null;
};

function rowToEntry(r: PipelineRow): PipelineEntry {
  return {
    id: r.id,
    candidateId: r.candidate_id,
    candidateLabel: r.candidate_label,
    archetype: r.archetype,
    roleFamily: r.role_family,
    jobId: r.job_id,
    jobTitle: r.job_title,
    stage: r.stage,
    matchScore: r.match_score,
    status: r.status,
    approvalKind: r.approval_kind,
    approvalDetail: r.approval_detail,
    createdAt: r.created_at,
    stageChangedAt: r.stage_changed_at,
  };
}

export function listPipeline(): PipelineEntry[] {
  const db = ensureDb();
  const rows = db
    .prepare(
      `SELECT id, candidate_id, candidate_label, archetype, role_family, job_id, job_title,
              stage, match_score, status, approval_kind, approval_detail, created_at, stage_changed_at
       FROM pipeline_entries WHERE status != 'rejected'
       ORDER BY job_title, match_score DESC`
    )
    .all() as PipelineRow[];
  return rows.map(rowToEntry);
}

export type CreatePipelineInput = {
  candidateId: string;
  candidateLabel: string;
  archetype?: string | null;
  roleFamily?: string | null;
  jobId: string;
  jobTitle: string;
  matchScore?: number | null;
  stage?: string;
};

// Idempotent: a (candidate, job) pair maps to one entry, so re-adding from Match
// or the recruiter view returns the existing row rather than duplicating it.
export function createPipelineEntry(input: CreatePipelineInput): { entry: PipelineEntry; created: boolean } {
  const db = ensureDb();
  const id = `m-${input.candidateId}-${input.jobId}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 90);
  const existing = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ?`).get(id) as PipelineRow | undefined;
  if (existing) {
    // re-surface a previously-rejected candidate if a recruiter re-adds them
    if (existing.status === "rejected") {
      db.prepare(`UPDATE pipeline_entries SET status='active', updated_at=? WHERE id=?`).run(
        new Date().toISOString(),
        id
      );
      const row = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ?`).get(id) as PipelineRow;
      return { entry: rowToEntry(row), created: false };
    }
    return { entry: rowToEntry(existing), created: false };
  }
  const now = new Date().toISOString();
  const stage = input.stage ?? "AI-matched";
  db.prepare(
    `INSERT INTO pipeline_entries
       (id, candidate_id, candidate_label, archetype, role_family, job_id, job_title,
        stage, match_score, status, approval_kind, approval_detail, created_at, stage_changed_at, updated_at)
     VALUES (@id, @candidate_id, @candidate_label, @archetype, @role_family, @job_id, @job_title,
        @stage, @match_score, 'active', NULL, '', @now, @now, @now)`
  ).run({
    id,
    candidate_id: input.candidateId,
    candidate_label: input.candidateLabel,
    archetype: input.archetype ?? null,
    role_family: input.roleFamily ?? null,
    job_id: input.jobId,
    job_title: input.jobTitle,
    stage,
    match_score: input.matchScore ?? null,
    now,
  });
  recordEvent(db, {
    entryId: id,
    candidateLabel: input.candidateLabel,
    jobTitle: input.jobTitle,
    archetype: input.archetype,
    kind: "added",
    toStage: stage,
    detail: "added to pipeline",
  });
  const row = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ?`).get(id) as PipelineRow;
  return { entry: rowToEntry(row), created: true };
}

// ---- Automation helpers (Phase 15) ----------------------------------------

export type AutomationEntry = PipelineEntry & { daysInStage: number; recentScreening: boolean };

export function getPipelineEntry(id: string): PipelineEntry | null {
  const db = ensureDb();
  const row = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ?`).get(id) as PipelineRow | undefined;
  return row ? rowToEntry(row) : null;
}

/** Active entries enriched with daysInStage + whether a screening decision is <24h old (Task 7 input). */
export function listActiveEntriesForAutomation(): AutomationEntry[] {
  const db = ensureDb();
  const rows = db
    .prepare(
      `SELECT id, candidate_id, candidate_label, archetype, role_family, job_id, job_title,
              stage, match_score, status, approval_kind, approval_detail, created_at, stage_changed_at
       FROM pipeline_entries WHERE status = 'active'`
    )
    .all() as PipelineRow[];
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const recent = new Set(
    (
      db
        .prepare(`SELECT DISTINCT entry_id FROM pipeline_events WHERE kind LIKE 'screening%' AND created_at > ?`)
        .all(cutoff) as { entry_id: string }[]
    ).map((r) => r.entry_id)
  );
  return rows.map((r) => {
    const days = r.stage_changed_at ? Math.floor((Date.now() - Date.parse(r.stage_changed_at)) / 86_400_000) : 0;
    return { ...rowToEntry(r), daysInStage: days, recentScreening: recent.has(r.id) };
  });
}

/** Set/clear a pending approval without a stage change (Task 1 hold, Task 5 scorecard gate). */
export function setApproval(entryId: string, approvalKind: string | null, approvalDetail: string): void {
  const db = ensureDb();
  db.prepare(`UPDATE pipeline_entries SET approval_kind=?, approval_detail=?, updated_at=? WHERE id=?`).run(
    approvalKind,
    approvalDetail,
    new Date().toISOString(),
    entryId
  );
}

export function recordAutomationEvent(entryId: string, kind: string, detail?: string): void {
  const db = ensureDb();
  const row = db
    .prepare(`SELECT candidate_label, job_title, archetype, stage FROM pipeline_entries WHERE id = ?`)
    .get(entryId) as { candidate_label: string; job_title: string | null; archetype: string | null; stage: string } | undefined;
  recordEvent(db, {
    entryId,
    candidateLabel: row?.candidate_label ?? null,
    jobTitle: row?.job_title ?? null,
    archetype: row?.archetype ?? null,
    kind,
    toStage: row?.stage ?? null,
    detail: detail ?? null,
  });
}

/** True if an event of this kind for the entry was already logged today (UTC) — alert dedup. */
export function hasEventToday(entryId: string, kind: string): boolean {
  const db = ensureDb();
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  return !!db
    .prepare(`SELECT 1 FROM pipeline_events WHERE entry_id=? AND kind=? AND created_at>=? LIMIT 1`)
    .get(entryId, kind, start.toISOString());
}

// ---- Fit matrix (Phase 16) ------------------------------------------------

export type MatrixProfile = { id: string; label: string; archetype: string | null; payload: unknown };

export function listMatrixProfiles(limit = 200): MatrixProfile[] {
  const db = ensureDb();
  const rows = db
    .prepare(`SELECT id, label, archetype, payload_json FROM profiles ORDER BY created_at ASC LIMIT ?`)
    .all(limit) as { id: string; label: string; archetype: string | null; payload_json: string }[];
  return rows
    .map((r): MatrixProfile | null => {
      const payload = safeRowParse(r.payload_json, "listMatrixProfiles", r.id);
      return payload === null ? null : { id: r.id, label: r.label, archetype: r.archetype, payload };
    })
    .filter((p): p is MatrixProfile => p !== null);
}

/** Distinct positions we are actively hiring for = jobs that appear in the pipeline. */
export function listOpenPositions(): { id: string; title: string; roleFamily: string | null }[] {
  const db = ensureDb();
  return db
    .prepare(
      `SELECT DISTINCT job_id AS id, job_title AS title, role_family AS roleFamily
       FROM pipeline_entries WHERE job_id IS NOT NULL ORDER BY job_title`
    )
    .all() as { id: string; title: string; roleFamily: string | null }[];
}

/** candidateId|jobId -> {stage,status} for overlaying pipeline placement onto the matrix. */
export function pipelinePlacements(): Record<string, { stage: string; status: string }> {
  const db = ensureDb();
  const rows = db
    .prepare(`SELECT candidate_id, job_id, stage, status FROM pipeline_entries WHERE candidate_id IS NOT NULL AND job_id IS NOT NULL`)
    .all() as { candidate_id: string; job_id: string; stage: string; status: string }[];
  const map: Record<string, { stage: string; status: string }> = {};
  for (const r of rows) map[`${r.candidate_id}|${r.job_id}`] = { stage: r.stage, status: r.status };
  return map;
}

// ---- Background tasks queue (Phase 17) ------------------------------------

export type TaskStatus = "queued" | "running" | "succeeded" | "failed" | "canceled" | "interrupted";

export type TaskRecord = {
  id: string;
  kind: string;
  dedupeKey: string | null;
  label: string | null;
  status: TaskStatus;
  params: unknown;
  result: unknown;
  error: string | null;
  progressDone: number;
  progressTotal: number;
  progressMsg: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

type TaskRow = {
  id: string;
  kind: string;
  dedupe_key: string | null;
  label: string | null;
  status: string;
  params_json: string | null;
  result_json: string | null;
  error: string | null;
  progress_done: number;
  progress_total: number;
  progress_msg: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

function rowToTask(r: TaskRow): TaskRecord {
  return {
    id: r.id,
    kind: r.kind,
    dedupeKey: r.dedupe_key,
    label: r.label,
    status: r.status as TaskStatus,
    params: safeRowParse(r.params_json, "task.params", r.id),
    result: safeRowParse(r.result_json, "task.result", r.id),
    error: r.error,
    progressDone: r.progress_done ?? 0,
    progressTotal: r.progress_total ?? 0,
    progressMsg: r.progress_msg,
    createdAt: r.created_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}

export function createTask(id: string, kind: string, dedupeKey: string | null, label: string | null, params: unknown): TaskRecord {
  const db = ensureDb();
  db.prepare(
    `INSERT INTO tasks (id, kind, dedupe_key, label, status, params_json, created_at) VALUES (?, ?, ?, ?, 'queued', ?, ?)`
  ).run(id, kind, dedupeKey, label, JSON.stringify(params ?? null), new Date().toISOString());
  return getTask(id)!;
}

export function getTask(id: string): TaskRecord | null {
  const db = ensureDb();
  const r = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as TaskRow | undefined;
  return r ? rowToTask(r) : null;
}

/** Dedup: an in-flight task with the same key is reused instead of starting a duplicate. */
export function getActiveTaskByDedupe(dedupeKey: string): TaskRecord | null {
  const db = ensureDb();
  const r = db
    .prepare(`SELECT * FROM tasks WHERE dedupe_key = ? AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1`)
    .get(dedupeKey) as TaskRow | undefined;
  return r ? rowToTask(r) : null;
}

export function listTasks(limit = 40): TaskRecord[] {
  const db = ensureDb();
  const rows = db
    .prepare(
      `SELECT * FROM tasks
       ORDER BY (CASE WHEN status IN ('queued','running') THEN 0 ELSE 1 END),
                CASE WHEN status IN ('queued','running') THEN created_at END ASC,
                finished_at DESC
       LIMIT ?`
    )
    .all(limit) as TaskRow[];
  return rows.map(rowToTask);
}

export function markTaskRunning(id: string): void {
  const db = ensureDb();
  db.prepare(`UPDATE tasks SET status='running', started_at=? WHERE id=?`).run(new Date().toISOString(), id);
}

export function setTaskProgress(id: string, done: number, total: number, msg?: string): void {
  const db = ensureDb();
  db.prepare(`UPDATE tasks SET progress_done=?, progress_total=?, progress_msg=? WHERE id=?`).run(done, total, msg ?? null, id);
}

export function finishTask(id: string, status: TaskStatus, opts: { result?: unknown; error?: string }): void {
  const db = ensureDb();
  db.prepare(`UPDATE tasks SET status=?, result_json=?, error=?, finished_at=? WHERE id=?`).run(
    status,
    opts.result !== undefined ? JSON.stringify(opts.result) : null,
    opts.error ?? null,
    new Date().toISOString(),
    id
  );
}

/** On server boot any task still 'running'/'queued' was orphaned by the restart. */
export function interruptStaleTasks(): number {
  const db = ensureDb();
  const info = db
    .prepare(`UPDATE tasks SET status='interrupted', finished_at=? WHERE status IN ('running','queued')`)
    .run(new Date().toISOString());
  return info.changes as number;
}

// ---- Dev extension — approved case scenarios (Phase D3) -------------------

export type DevCaseRecord = {
  id: string;
  title: string | null;
  roleTitle: string | null;
  seniority: string | null;
  need: unknown;
  analysis: unknown;
  role: unknown;
  case: unknown;
  status: string;
  createdAt: string;
};

type DevCaseRow = {
  id: string;
  title: string | null;
  role_title: string | null;
  seniority: string | null;
  need_json: string | null;
  analysis_json: string | null;
  role_json: string | null;
  case_json: string | null;
  status: string;
  created_at: string;
};

const parseJson = (s: string | null): unknown => {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

function rowToDevCase(r: DevCaseRow): DevCaseRecord {
  return {
    id: r.id,
    title: r.title,
    roleTitle: r.role_title,
    seniority: r.seniority,
    need: parseJson(r.need_json),
    analysis: parseJson(r.analysis_json),
    role: parseJson(r.role_json),
    case: parseJson(r.case_json),
    status: r.status,
    createdAt: r.created_at,
  };
}

export function saveDevCase(input: {
  need: unknown;
  analysis: unknown;
  role: { title?: string; seniority?: string } & Record<string, unknown>;
  case: { title?: string } & Record<string, unknown>;
}): { id: string; createdAt: string } {
  const db = ensureDb();
  const now = new Date().toISOString();
  const id = `dc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(
    `INSERT INTO dev_cases (id, title, role_title, seniority, need_json, analysis_json, role_json, case_json, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?)`
  ).run(
    id,
    input.case.title ?? null,
    input.role.title ?? null,
    input.role.seniority ?? null,
    JSON.stringify(input.need ?? null),
    JSON.stringify(input.analysis ?? null),
    JSON.stringify(input.role ?? null),
    JSON.stringify(input.case ?? null),
    now
  );
  return { id, createdAt: now };
}

export function listDevCases(limit = 50): DevCaseRecord[] {
  const db = ensureDb();
  const rows = db.prepare(`SELECT * FROM dev_cases ORDER BY created_at DESC LIMIT ?`).all(limit) as DevCaseRow[];
  return rows.map(rowToDevCase);
}

export function getDevCase(id: string): DevCaseRecord | null {
  const db = ensureDb();
  const r = db.prepare(`SELECT * FROM dev_cases WHERE id = ?`).get(id) as DevCaseRow | undefined;
  return r ? rowToDevCase(r) : null;
}

// ---- Dev extension — lifecycle orchestration state (Direction A) -----------

export type LifecycleRecord = {
  id: string;
  title: string | null;
  stage: string;
  auto: boolean;
  need: unknown;
  analysis: unknown;
  role: unknown;
  case: unknown;
  caseId: string | null;
  postingId: string | null;
  detail: string | null;
  createdAt: string;
  updatedAt: string | null;
};

function rowToLifecycle(r: Record<string, unknown>): LifecycleRecord {
  return {
    id: r.id as string,
    title: (r.title as string) ?? null,
    stage: r.stage as string,
    auto: Number(r.auto ?? 1) === 1,
    need: parseJson((r.need_json as string) ?? null),
    analysis: parseJson((r.analysis_json as string) ?? null),
    role: parseJson((r.role_json as string) ?? null),
    case: parseJson((r.case_json as string) ?? null),
    caseId: (r.case_id as string) ?? null,
    postingId: (r.posting_id as string) ?? null,
    detail: (r.detail as string) ?? null,
    createdAt: r.created_at as string,
    updatedAt: (r.updated_at as string) ?? null,
  };
}

export function createLifecycle(need: { title?: string } & Record<string, unknown>, auto: boolean): LifecycleRecord {
  const db = ensureDb();
  const now = new Date().toISOString();
  const id = `lc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(
    `INSERT INTO dev_lifecycle (id, title, stage, auto, need_json, detail, created_at, updated_at)
     VALUES (?, ?, 'intake', ?, ?, 'created', ?, ?)`
  ).run(id, need.title ?? "Untitled role", auto ? 1 : 0, JSON.stringify(need), now, now);
  return getLifecycle(id)!;
}

export function getLifecycle(id: string): LifecycleRecord | null {
  const db = ensureDb();
  const r = db.prepare(`SELECT * FROM dev_lifecycle WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  return r ? rowToLifecycle(r) : null;
}

export function listLifecycles(limit = 50): LifecycleRecord[] {
  const db = ensureDb();
  const rows = db.prepare(`SELECT * FROM dev_lifecycle ORDER BY created_at DESC LIMIT ?`).all(limit) as Array<Record<string, unknown>>;
  return rows.map(rowToLifecycle);
}

export function lifecycleByPosting(postingId: string): LifecycleRecord | null {
  const db = ensureDb();
  const r = db.prepare(`SELECT * FROM dev_lifecycle WHERE posting_id = ? LIMIT 1`).get(postingId) as Record<string, unknown> | undefined;
  return r ? rowToLifecycle(r) : null;
}

/** Patch a lifecycle record (stage + any artifact columns) and stamp updated_at. */
export function updateLifecycle(
  id: string,
  patch: { stage?: string; analysis?: unknown; role?: unknown; case?: unknown; caseId?: string; postingId?: string; detail?: string }
): void {
  const db = ensureDb();
  const sets: string[] = ["updated_at = ?"];
  const vals: unknown[] = [new Date().toISOString()];
  if (patch.stage !== undefined) (sets.push("stage = ?"), vals.push(patch.stage));
  if (patch.analysis !== undefined) (sets.push("analysis_json = ?"), vals.push(JSON.stringify(patch.analysis)));
  if (patch.role !== undefined) (sets.push("role_json = ?"), vals.push(JSON.stringify(patch.role)));
  if (patch.case !== undefined) (sets.push("case_json = ?"), vals.push(JSON.stringify(patch.case)));
  if (patch.caseId !== undefined) (sets.push("case_id = ?"), vals.push(patch.caseId));
  if (patch.postingId !== undefined) (sets.push("posting_id = ?"), vals.push(patch.postingId));
  if (patch.detail !== undefined) (sets.push("detail = ?"), vals.push(patch.detail));
  vals.push(id);
  db.prepare(`UPDATE dev_lifecycle SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
}

// ---- Dev extension — distribution: postings (OUT) + submissions (IN) (D4) -

export type Posting = {
  id: string;
  caseId: string | null;
  channel: string;
  token: string | null;
  roleTitle: string | null;
  caseTitle: string | null;
  status: string;
  createdAt: string;
  submissionCount?: number;
};

export type DevSubmission = {
  id: string;
  postingId: string | null;
  candidateRef: string | null;
  repoRef: string | null;
  notes: string | null;
  contact: string | null;
  status: string;
  evaluation: unknown;
  transferScore: number | null;
  receivedAt: string;
};

function rowToSubmission(r: Record<string, unknown>): DevSubmission {
  return {
    id: r.id as string,
    postingId: (r.posting_id as string) ?? null,
    candidateRef: (r.candidate_ref as string) ?? null,
    repoRef: (r.repo_ref as string) ?? null,
    notes: (r.notes as string) ?? null,
    contact: (r.contact as string) ?? null,
    status: r.status as string,
    evaluation: parseJson((r.eval_json as string) ?? null),
    transferScore: r.transfer_score == null ? null : Number(r.transfer_score),
    receivedAt: r.received_at as string,
  };
}

// ---- Dev extension — comms outbox (Direction B) ---------------------------

export type OutboxEntry = {
  id: string;
  recipient: string | null;
  subject: string | null;
  body: string | null;
  kind: string | null;
  channel: string | null;
  status: string;
  ref: string | null;
  createdAt: string;
};

export function recordOutbox(input: {
  recipient: string;
  subject: string;
  body: string;
  kind: string;
  channel: string;
  status: string;
  ref?: string | null;
}): OutboxEntry {
  const db = ensureDb();
  const now = new Date().toISOString();
  const id = `out-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(
    `INSERT INTO dev_outbox (id, recipient, subject, body, kind, channel, status, ref, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, input.recipient, input.subject, input.body, input.kind, input.channel, input.status, input.ref ?? null, now);
  return { id, ...input, ref: input.ref ?? null, createdAt: now };
}

export function listOutbox(limit = 50): OutboxEntry[] {
  const db = ensureDb();
  const rows = db.prepare(`SELECT * FROM dev_outbox ORDER BY created_at DESC LIMIT ?`).all(limit) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: r.id as string,
    recipient: (r.recipient as string) ?? null,
    subject: (r.subject as string) ?? null,
    body: (r.body as string) ?? null,
    kind: (r.kind as string) ?? null,
    channel: (r.channel as string) ?? null,
    status: r.status as string,
    ref: (r.ref as string) ?? null,
    createdAt: r.created_at as string,
  }));
}

export function createPosting(input: {
  caseId: string;
  channel: string;
  token: string;
  roleTitle: string | null;
  caseTitle: string | null;
}): Posting {
  const db = ensureDb();
  const now = new Date().toISOString();
  const id = `pst-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(
    `INSERT INTO dev_postings (id, case_id, channel, token, role_title, case_title, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`
  ).run(id, input.caseId, input.channel, input.token, input.roleTitle, input.caseTitle, now);
  return { id, caseId: input.caseId, channel: input.channel, token: input.token, roleTitle: input.roleTitle, caseTitle: input.caseTitle, status: "open", createdAt: now };
}

export function listPostings(): Posting[] {
  const db = ensureDb();
  const rows = db
    .prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM dev_submissions s WHERE s.posting_id = p.id) AS submission_count
       FROM dev_postings p ORDER BY p.created_at DESC`
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: r.id as string,
    caseId: (r.case_id as string) ?? null,
    channel: r.channel as string,
    token: (r.token as string) ?? null,
    roleTitle: (r.role_title as string) ?? null,
    caseTitle: (r.case_title as string) ?? null,
    status: r.status as string,
    createdAt: r.created_at as string,
    submissionCount: Number(r.submission_count ?? 0),
  }));
}

export function getPostingByToken(token: string): Posting | null {
  const db = ensureDb();
  const r = db.prepare(`SELECT * FROM dev_postings WHERE token = ?`).get(token) as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    id: r.id as string,
    caseId: (r.case_id as string) ?? null,
    channel: r.channel as string,
    token: (r.token as string) ?? null,
    roleTitle: (r.role_title as string) ?? null,
    caseTitle: (r.case_title as string) ?? null,
    status: r.status as string,
    createdAt: r.created_at as string,
  };
}

// Atomic, idempotent on (posting, candidate, repo): the UNIQUE index +
// ON CONFLICT DO NOTHING make a concurrent double-submit impossible at the DB
// level (no read-then-write race). `created` is false when the row already
// existed; the canonical row is always re-selected and returned.
export function createSubmission(input: {
  postingId: string;
  candidateRef: string;
  repoRef: string;
  notes?: string;
  contact?: string;
}): { submission: DevSubmission; created: boolean } {
  const db = ensureDb();
  const now = new Date().toISOString();
  const id = `sub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const info = db
    .prepare(
      `INSERT INTO dev_submissions (id, posting_id, candidate_ref, repo_ref, notes, contact, status, received_at)
       VALUES (?, ?, ?, ?, ?, ?, 'received', ?)
       ON CONFLICT DO NOTHING`
    )
    .run(id, input.postingId, input.candidateRef, input.repoRef, input.notes ?? null, input.contact ?? null, now);
  const created = Number(info.changes) > 0;
  // Re-select the canonical row: ours if just created, otherwise the row that
  // won the race / was inserted earlier.
  const row = db
    .prepare(
      `SELECT * FROM dev_submissions
       WHERE posting_id = ? AND candidate_ref = ? AND repo_ref = ?
       ORDER BY received_at ASC LIMIT 1`
    )
    .get(input.postingId, input.candidateRef, input.repoRef) as Record<string, unknown>;
  return { submission: rowToSubmission(row), created };
}

export function listSubmissions(postingId?: string): DevSubmission[] {
  const db = ensureDb();
  const rows = (
    postingId
      ? db.prepare(`SELECT * FROM dev_submissions WHERE posting_id = ? ORDER BY received_at DESC`).all(postingId)
      : db.prepare(`SELECT * FROM dev_submissions ORDER BY received_at DESC`).all()
  ) as Array<Record<string, unknown>>;
  return rows.map(rowToSubmission);
}

export function getSubmission(id: string): DevSubmission | null {
  const db = ensureDb();
  const r = db.prepare(`SELECT * FROM dev_submissions WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  return r ? rowToSubmission(r) : null;
}

export function getPosting(id: string): Posting | null {
  const db = ensureDb();
  const r = db.prepare(`SELECT * FROM dev_postings WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    id: r.id as string,
    caseId: (r.case_id as string) ?? null,
    channel: r.channel as string,
    token: (r.token as string) ?? null,
    roleTitle: (r.role_title as string) ?? null,
    caseTitle: (r.case_title as string) ?? null,
    status: r.status as string,
    createdAt: r.created_at as string,
  };
}

export function saveSubmissionEvaluation(id: string, evaluation: unknown, transferScore: number): void {
  const db = ensureDb();
  db.prepare(`UPDATE dev_submissions SET eval_json = ?, transfer_score = ?, status = 'evaluated' WHERE id = ?`).run(
    JSON.stringify(evaluation ?? null),
    transferScore,
    id
  );
}

export type PipelineAction = "accept" | "reject" | "approve_event";

export function actOnPipelineEntry(id: string, action: PipelineAction, detail?: string): PipelineEntry | null {
  const db = ensureDb();
  const row = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ?`).get(id) as PipelineRow | undefined;
  if (!row) return null;
  const now = new Date().toISOString();
  const meta = {
    entryId: id,
    candidateLabel: row.candidate_label,
    jobTitle: row.job_title,
    archetype: row.archetype,
    fromStage: row.stage,
  };

  if (action === "reject") {
    db.prepare(`UPDATE pipeline_entries SET status='rejected', approval_kind=NULL, updated_at=? WHERE id=?`).run(now, id);
    recordEvent(db, { ...meta, kind: "rejected", toStage: row.stage });
  } else if (action === "approve_event") {
    // Honor a slot override (the shared calendar lets you move a candidate's
    // proposed time); fall back to the originally-proposed slot.
    const slot = detail && detail.trim() ? detail.trim() : row.approval_detail;
    db.prepare(
      `UPDATE pipeline_entries SET stage='Interview', approval_kind=NULL, approval_detail='', stage_changed_at=?, updated_at=? WHERE id=?`
    ).run(now, now, id);
    recordEvent(db, { ...meta, kind: "scheduled", toStage: "Interview", detail: slot });
  } else if (row.approval_kind === "screening_review") {
    // Accepting an AI screening flows the candidate into interview scheduling:
    // advance a stage AND queue them on the calendar (Schedule tab) with a
    // default proposed slot, so the interviewer can pick a time + open the prep.
    const idx = PIPELINE_STAGES.indexOf(row.stage as PipelineStage);
    const next = PIPELINE_STAGES[Math.min(idx + 1, PIPELINE_STAGES.length - 1)];
    db.prepare(
      `UPDATE pipeline_entries SET stage=?, approval_kind='calendar', approval_detail=?, stage_changed_at=?, updated_at=? WHERE id=?`
    ).run(next, "Tue 14:00", now, now, id);
    recordEvent(db, { ...meta, kind: "advanced", toStage: next });
  } else {
    // accept: advance one stage, clear any pending approval
    const idx = PIPELINE_STAGES.indexOf(row.stage as PipelineStage);
    const next = PIPELINE_STAGES[Math.min(idx + 1, PIPELINE_STAGES.length - 1)];
    db.prepare(
      `UPDATE pipeline_entries SET stage=?, approval_kind=NULL, approval_detail='', stage_changed_at=?, updated_at=? WHERE id=?`
    ).run(next, now, now, id);
    recordEvent(db, { ...meta, kind: "advanced", toStage: next });
  }
  const updated = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ?`).get(id) as PipelineRow;
  return rowToEntry(updated);
}
