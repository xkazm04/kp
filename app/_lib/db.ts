import path from "node:path";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import Database from "better-sqlite3";

const DB_PATH = process.env.KP_DB_PATH ?? path.join(process.cwd(), "data", "kp.sqlite");

let _db: Database.Database | null = null;

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
      updated_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_pipeline_job ON pipeline_entries (job_id);
    CREATE INDEX IF NOT EXISTS idx_pipeline_stage ON pipeline_entries (stage);
  `);
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

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
function generateSlug(): string {
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
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
  const slug = generateSlug();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO analyses
      (slug, candidate_label, jd_slug, score, role_family, seniority, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    slug,
    input.candidateLabel,
    input.jdSlug,
    input.score,
    input.roleFamily,
    input.seniority,
    JSON.stringify(input.payload),
    createdAt
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
  const slug = generateSlug();
  const createdAt = new Date().toISOString();
  db.prepare(`INSERT INTO jds (slug, title, body, created_at) VALUES (?, ?, ?, ?)`).run(
    slug,
    input.title,
    input.body,
    createdAt
  );
  return { slug, createdAt };
}

export function listJds(limit = 100): JdRow[] {
  const db = ensureDb();
  return db
    .prepare(`SELECT slug, title, body, created_at FROM jds ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as JdRow[];
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
  if (!existsSync(SEED_JOBS_PATH)) return;
  let jobs: JobRecord[];
  try {
    jobs = JSON.parse(readFileSync(SEED_JOBS_PATH, "utf-8")) as JobRecord[];
  } catch {
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
  params.limit = filter.limit ?? 300;
  const rows = db
    .prepare(
      `SELECT payload_json FROM jobs ${clause}
       ORDER BY is_entry_eligible DESC, graduate_friendliness DESC, id LIMIT @limit`
    )
    .all(params) as { payload_json: string }[];
  return rows.map((r) => JSON.parse(r.payload_json) as JobRecord);
}

export function getJob(id: string): JobRecord | null {
  const db = ensureDb();
  const row = db.prepare(`SELECT payload_json FROM jobs WHERE id = ?`).get(id) as
    | { payload_json: string }
    | undefined;
  return row ? (JSON.parse(row.payload_json) as JobRecord) : null;
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
  const id = generateSlug();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO profiles (id, label, archetype, role_family, completeness, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.label,
    input.archetype,
    input.roleFamily,
    input.completeness,
    JSON.stringify(input.payload),
    createdAt
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
  if (!existsSync(SEED_CANDIDATES_PATH)) return;
  let records: Array<Record<string, unknown>>;
  try {
    records = JSON.parse(readFileSync(SEED_CANDIDATES_PATH, "utf-8"));
  } catch {
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
};

const SEED_PIPELINE_PATH = path.join(process.cwd(), "data", "seed_pipeline", "pipeline.json");

function seedPipeline(db: Database.Database): void {
  const count = db.prepare(`SELECT COUNT(*) AS n FROM pipeline_entries`).get() as { n: number };
  if (count.n > 0) return;
  if (!existsSync(SEED_PIPELINE_PATH)) return;
  let entries: PipelineEntry[];
  try {
    entries = JSON.parse(readFileSync(SEED_PIPELINE_PATH, "utf-8"));
  } catch {
    return;
  }
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO pipeline_entries
       (id, candidate_id, candidate_label, archetype, role_family, job_id, job_title,
        stage, match_score, status, approval_kind, approval_detail, updated_at)
     VALUES (@id, @candidate_id, @candidate_label, @archetype, @role_family, @job_id, @job_title,
        @stage, @match_score, @status, @approval_kind, @approval_detail, @updated_at)`
  );
  const tx = db.transaction((rows: PipelineEntry[]) => {
    for (const e of rows) {
      if (!e?.id) continue;
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
        updated_at: now,
      });
    }
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
  };
}

export function listPipeline(): PipelineEntry[] {
  const db = ensureDb();
  const rows = db
    .prepare(
      `SELECT id, candidate_id, candidate_label, archetype, role_family, job_id, job_title,
              stage, match_score, status, approval_kind, approval_detail
       FROM pipeline_entries WHERE status != 'rejected'
       ORDER BY job_title, match_score DESC`
    )
    .all() as PipelineRow[];
  return rows.map(rowToEntry);
}

export type PipelineAction = "accept" | "reject" | "approve_event";

export function actOnPipelineEntry(id: string, action: PipelineAction): PipelineEntry | null {
  const db = ensureDb();
  const row = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ?`).get(id) as PipelineRow | undefined;
  if (!row) return null;
  const now = new Date().toISOString();

  if (action === "reject") {
    db.prepare(`UPDATE pipeline_entries SET status='rejected', approval_kind=NULL, updated_at=? WHERE id=?`).run(now, id);
  } else if (action === "approve_event") {
    db.prepare(`UPDATE pipeline_entries SET stage='Interview', approval_kind=NULL, approval_detail='', updated_at=? WHERE id=?`).run(now, id);
  } else {
    // accept: advance one stage, clear any pending approval
    const idx = PIPELINE_STAGES.indexOf(row.stage as PipelineStage);
    const next = PIPELINE_STAGES[Math.min(idx + 1, PIPELINE_STAGES.length - 1)];
    db.prepare(`UPDATE pipeline_entries SET stage=?, approval_kind=NULL, approval_detail='', updated_at=? WHERE id=?`).run(next, now, id);
  }
  const updated = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ?`).get(id) as PipelineRow;
  return rowToEntry(updated);
}
