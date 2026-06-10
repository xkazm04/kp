import path from "node:path";
import { readFileSync, existsSync } from "node:fs";
import Database from "better-sqlite3";
import type { ApprovalKind } from "./approval-kinds";
import { isTerminalEntryStatus, TERMINAL_ENTRY_STATUSES } from "./pipeline-status";
import { coerceOutboxStatus, type OutboxStatus } from "./comms-status";
import { coerceInterviewRecommendation, type InterviewRecommendation } from "./interview-recommendation";
import type { ScorecardRating } from "./interview-scorecard";
import { normalizeApplicantName, normalizeContact } from "./apply-intake";
import { coerceProviderId, type VoiceProviderId, type VoiceTurn } from "./voice/types";
import { DB_PATH, ensureDbDir } from "./db-path";
import { randomId, randomToken } from "./random-id";
import { chunk, SQL_IN_CHUNK } from "./entries-param";
import { pickBottleneck, type Bottleneck } from "./analytics-bottleneck";
import { MOMENTUM_EVENT_KINDS, MOMENTUM_WEEKS, weeklyMomentum, type MomentumWeek } from "./analytics-momentum";
import { summarizeAutomationImpact, type AutomationImpact } from "./decision-attribution";
import { coerceGithubEvidenceSummary, type GithubEvidenceSummary } from "./github-summary";
import { recordPipelineOutcome } from "./dev-outcomes";
import { recordAudit } from "./dev-control";
import type { DevNeed } from "./devcase-run";

let _db: Database.Database | null = null;

// ---- Seed health (boot diagnostics) ---------------------------------------
// A corrupt or absent seed file used to leave a table silently empty while
// ensureDb() still completed and cached _db, so Jobs/Match/recruiter views all
// rendered empty with no error, log, or signal — a one-character JSON typo
// became an hours-long "why is everything empty" hunt. We now record every
// seed read/parse failure with its path + reason so an empty catalog is
// diagnosable. Consumers can read getSeedHealth() or surface it on first request.

export type SeedIssue = {
  seed: "jobs" | "candidates" | "analyses" | "pipeline";
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
 * Load a seed file as a JSON array, recording the one issue kind that applies
 * and returning null so the caller bails before its insert transaction. This is
 * the single place the three seed-load failure modes are handled — missing file
 * (warn), unreadable/invalid JSON (error), and a top-level value that isn't an
 * array (error) — so every seeder degrades identically and adding a new seed is
 * just a load call plus its insert. The empty-table guard stays per-seeder
 * (only some seeders re-seed on every boot), and `T` is asserted, not validated:
 * callers already skip malformed rows during insert.
 */
function loadSeedArray<T>(seed: SeedIssue["seed"], filePath: string): T[] | null {
  if (!existsSync(filePath)) {
    recordSeedIssue({ seed, path: filePath, reason: "file does not exist", severity: "missing" });
    return null;
  }
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch (error) {
    recordSeedIssue({
      seed,
      path: filePath,
      reason: error instanceof Error ? error.message : String(error),
      severity: "error",
    });
    return null;
  }
  if (!Array.isArray(data)) {
    recordSeedIssue({ seed, path: filePath, reason: "seed JSON is not an array", severity: "error" });
    return null;
  }
  return data as T[];
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
  ensureDbDir();
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  // The scheduler writes scheduler/scheduler_runs on its own connection to the
  // same kp.sqlite file while the policy pass writes pipeline_entries/events here.
  // A busy_timeout makes a concurrent writer wait briefly rather than instantly
  // throwing SQLITE_BUSY.
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS analyses (
      slug TEXT PRIMARY KEY,
      candidate_label TEXT NOT NULL,
      jd_slug TEXT,
      score INTEGER,
      role_family TEXT,
      seniority TEXT,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      -- Human-in-the-loop record on a saved analysis (RES5): the recruiter's
      -- disposition (advance | hold | pass) + a free-text reason. The report was
      -- read-only — AiDisclosure promises "a human makes every decision" but it was
      -- never captured against the analysis. NULL = not yet dispositioned.
      disposition TEXT,
      decision_note TEXT
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

    -- Generic prompt cache (see lookup/store/prunePromptCache). Name is legacy:
    -- the real provider is ClaudeCliProvider, kept to preserve existing rows.
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
      updated_at TEXT,
      -- Intake degradation flag: set when an inbound application could not be
      -- normalized into a matchable profile and was demoted to a label-only stub.
      -- Turns a silent, server-log-only demotion into a visible recruiter signal
      -- (the entry needs manual profile capture). The reason carries the bounded
      -- failure detail so the recruiter knows what to recover.
      intake_degraded INTEGER NOT NULL DEFAULT 0,
      intake_degraded_reason TEXT,
      -- Candidate contact (email/phone) captured at inbound apply. The data model
      -- otherwise stores no address, so every downstream comm dead-lettered to the
      -- literal "candidate"; when present this is the deliverable recipient
      -- (candidateRecipient prefers it). Optional — recruiter/Match adds omit it.
      contact TEXT
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

    -- Voice 1st-round interview sessions (MVP). One row per call; token-gated
    -- candidate link, transcript-only by default (no audio retained), optional
    -- link to a pipeline entry so the scorecard feeds the Interview->Offer gate.
    CREATE TABLE IF NOT EXISTS interview_sessions (
      id TEXT PRIMARY KEY,
      token TEXT UNIQUE,
      entry_id TEXT,
      candidate_label TEXT,
      job_id TEXT,
      job_title TEXT,
      provider TEXT NOT NULL,
      language TEXT,
      mode TEXT NOT NULL DEFAULT 'test',
      status TEXT NOT NULL DEFAULT 'created',
      instructions TEXT,
      run_of_show_json TEXT,
      duration_min INTEGER,
      consent_at TEXT,
      started_at TEXT,
      ended_at TEXT,
      transcript_json TEXT,
      scorecard_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_interview_token ON interview_sessions (token);
    CREATE INDEX IF NOT EXISTS idx_interview_entry ON interview_sessions (entry_id);
  `);
  // Migration for DBs created before the observability columns existed.
  for (const col of ["created_at", "stage_changed_at"]) {
    try {
      db.exec(`ALTER TABLE pipeline_entries ADD COLUMN ${col} TEXT`);
    } catch {
      /* column already exists */
    }
  }
  // Migration for DBs created before the intake-degradation flag existed. The
  // boolean column is NOT NULL DEFAULT 0 so legacy rows read as "not degraded".
  for (const sql of [
    "ALTER TABLE pipeline_entries ADD COLUMN intake_degraded INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE pipeline_entries ADD COLUMN intake_degraded_reason TEXT",
    // Candidate contact captured at inbound apply (idea APP2) — makes the comms
    // stack deliverable for applicants instead of dead-lettering to "candidate".
    "ALTER TABLE pipeline_entries ADD COLUMN contact TEXT",
    // Compact GitHub evidence summary captured at add-to-pipeline (GH2):
    // coerceGithubEvidenceSummary-shaped JSON, bounded at write AND read.
    "ALTER TABLE pipeline_entries ADD COLUMN github_json TEXT",
  ]) {
    try {
      db.exec(sql);
    } catch {
      /* column already exists */
    }
  }
  // Migration for dev_submissions evaluation + contact columns (Phase D6 / B),
  // plus the interview run-of-show column added when the voice screen grew a
  // candidate-facing agenda, and duration_min so the candidate portal shows the
  // session's true length instead of a hardcoded "5 minutes" (idea-0ecbe5a5).
  for (const sql of [
    "ALTER TABLE dev_submissions ADD COLUMN eval_json TEXT",
    "ALTER TABLE dev_submissions ADD COLUMN transfer_score INTEGER",
    "ALTER TABLE dev_submissions ADD COLUMN contact TEXT",
    "ALTER TABLE interview_sessions ADD COLUMN run_of_show_json TEXT",
    "ALTER TABLE interview_sessions ADD COLUMN duration_min INTEGER",
    // Case-designed interview: the role's AI-interview scenario generated from the
    // approved case (devcase/interview_scenario.py) — one per role, reused for
    // every candidate so ratings stay comparable.
    "ALTER TABLE dev_cases ADD COLUMN scenario_json TEXT",
    // Materialized seed: the case's concrete starter file tree
    // (devcase/seed_materializer.py) — one per case, identical for every
    // candidate, so the submission is a diff against shared ground truth.
    "ALTER TABLE dev_cases ADD COLUMN seed_json TEXT",
    // draft→publish lifecycle for the jobs corpus. job-ingest.ts ALTERs this in on
    // its own connection; mirror it here so the db.ts connection can filter drafts
    // out of the rematch corpus (listCorpusJobs) even when ingestion never ran this
    // boot. NULL status = a seeded/live corpus job; authored JDs are 'draft' until
    // published.
    "ALTER TABLE jobs ADD COLUMN status TEXT",
    // Human disposition + reason on a saved analysis (RES5) — see the table CREATE.
    "ALTER TABLE analyses ADD COLUMN disposition TEXT",
    "ALTER TABLE analyses ADD COLUMN decision_note TEXT",
    // Count of warn-shaped sanityChecks (countSanityWarns), stamped at save so
    // the History list can flag degraded analyses without scanning payloads.
    // NULL on rows saved before the column existed — renders as "no pill".
    "ALTER TABLE analyses ADD COLUMN review_flags INTEGER",
    // GitHub deep-dive payload (GH1): validated GithubAnalysis JSON, attached
    // after save via PATCH /api/analyses/[slug] once the client holds both the
    // saved slug and a done GitHub result. NULL = no deep-dive ran for this row.
    "ALTER TABLE analyses ADD COLUMN github_json TEXT",
    // JD archive (W8-4/JDL1): archived JDs drop out of listJds and the pickers,
    // but loadJd keeps serving them so existing analysis links never 404.
    "ALTER TABLE jds ADD COLUMN archived_at TEXT",
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
  // Atomic task dedup across connections (the scheduler ticks on its own connection
  // and an external cron can hit /api/automation/run): a partial UNIQUE index forbids
  // two ACTIVE rows sharing a dedupe_key, turning startTask's app-level read-then-write
  // into a hard guarantee. Guarded like the submissions index — a legacy DB with
  // active duplicates keeps the app-level coalescing instead.
  try {
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_active_dedupe
         ON tasks (dedupe_key) WHERE status IN ('queued','running')`
    );
  } catch {
    /* pre-existing active duplicates prevent the unique index; skip */
  }
  seedExampleJd(db);
  seedJobs(db);
  seedCandidates(db);
  seedAnalyses(db);
  seedPipeline(db);
  migratePipelineStages(db); // remap any legacy 7-stage rows to the 5-stage model
  backfillDeclinedStatus(db); // split candidate declines out of overloaded `rejected`
  _db = db;
  // Reclaim expired (and, once their TTL lapses, superseded-PROMPT_VERSION)
  // cache rows on boot. lookupPromptCache only SKIPS expired rows — it never
  // deletes them — so without this the prompt cache table and its WAL grow
  // unbounded for the life of the deployment. _db is assigned first so the
  // ensureDb() inside prunePromptCache() short-circuits instead of re-entering
  // this initializer. A prune failure must never wedge boot.
  try {
    const pruned = prunePromptCache();
    if (pruned > 0) console.log(`[db] pruned ${pruned} expired prompt-cache row(s) on boot`);
  } catch (error) {
    console.error("[db] prompt-cache boot prune failed", error);
  }
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
  // RES5 — present on SELECTs that fetch them (loadAnalysis, listAnalyses);
  // optional because the narrower pool/JD SELECTs don't read them.
  disposition?: string | null;
  decision_note?: string | null;
  // SCOR2 — warn-shaped sanity-check count, same optionality rationale.
  review_flags?: number | null;
  // GH1 — attached GitHub deep-dive JSON, fetched only by loadAnalysis.
  github_json?: string | null;
};

// The recruiter dispositions a saved analysis can carry (RES5). advance/hold/pass
// mirror the language of the decision queue; "" clears the disposition.
export const ANALYSIS_DISPOSITIONS = ["advance", "hold", "pass"] as const;
export type AnalysisDisposition = (typeof ANALYSIS_DISPOSITIONS)[number];

export type AnalysisSummary = Omit<AnalysisRow, "payload_json">;

export type JdRow = {
  slug: string;
  title: string;
  body: string;
  created_at: string;
  // W8-4 — set when archived; loadJd still serves the row (banner, no 404).
  archived_at?: string | null;
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
  // Warn-shaped sanity-check count (countSanityWarns). Denormalized so the
  // History list can flag degraded analyses straight off the summary SELECT.
  reviewFlags?: number | null;
};

export function saveAnalysis(input: SaveAnalysisInput): { slug: string; createdAt: string } {
  const db = ensureDb();
  const createdAt = new Date().toISOString();
  const payloadJson = JSON.stringify(input.payload);
  const stmt = db.prepare(
    `INSERT INTO analyses
      (slug, candidate_label, jd_slug, score, role_family, seniority, payload_json, created_at, review_flags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      createdAt,
      input.reviewFlags ?? null
    )
  );
  return { slug, createdAt };
}

export function listAnalyses(limit = 100): AnalysisSummary[] {
  const db = ensureDb();
  const rows = db
    .prepare(
      `SELECT slug, candidate_label, jd_slug, score, role_family, seniority, created_at, disposition, decision_note, review_flags
       FROM analyses
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(limit) as AnalysisSummary[];
  return rows;
}

/** Record (or clear) the human disposition + note on a saved analysis (RES5).
 *  An empty/whitespace disposition clears both fields back to NULL. Returns false
 *  for an unknown slug. The display/storage is the analysis row itself — no event
 *  log, since an analysis isn't a pipeline entry. */
export function setAnalysisDisposition(slug: string, disposition: string, note: string): boolean {
  const db = ensureDb();
  const clean = (ANALYSIS_DISPOSITIONS as readonly string[]).includes(disposition) ? disposition : null;
  const noteVal = clean && note.trim() ? note.trim() : null;
  const res = db
    .prepare(`UPDATE analyses SET disposition = ?, decision_note = ? WHERE slug = ?`)
    .run(clean, clean ? noteVal : null, slug);
  return res.changes > 0;
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

// Like listAnalyses but folds payload_json into the one query, so callers that
// need every payload (e.g. the candidate pool) don't fire an N+1 of loadAnalysis.
export function listAnalysisRecords(limit = 100): { row: AnalysisRow; payload: unknown }[] {
  const db = ensureDb();
  const rows = db
    .prepare(
      `SELECT slug, candidate_label, jd_slug, score, role_family, seniority, payload_json, created_at
       FROM analyses ORDER BY created_at DESC LIMIT ?`
    )
    .all(limit) as AnalysisRow[];
  const out: { row: AnalysisRow; payload: unknown }[] = [];
  for (const row of rows) {
    const payload = safeRowParse(row.payload_json, "listAnalysisRecords", row.slug);
    if (payload == null) continue; // corrupt row already logged by safeRowParse; degrade to N-1
    out.push({ row, payload });
  }
  return out;
}

/** Attach (or replace) the GitHub deep-dive payload on a saved analysis (GH1).
 *  The caller (PATCH route) validates the shape; this stores the JSON string.
 *  Returns false for an unknown slug. */
export function setAnalysisGithub(slug: string, githubJson: string): boolean {
  const db = ensureDb();
  const res = db.prepare(`UPDATE analyses SET github_json = ? WHERE slug = ?`).run(githubJson, slug);
  return res.changes > 0;
}

export function loadAnalysis(slug: string): { row: AnalysisRow; payload: unknown } | null {
  const db = ensureDb();
  const row = db
    .prepare(
      `SELECT slug, candidate_label, jd_slug, score, role_family, seniority, payload_json, created_at, disposition, decision_note, github_json
       FROM analyses WHERE slug = ?`
    )
    .get(slug) as AnalysisRow | undefined;
  if (!row) return null;
  const payload = safeRowParse(row.payload_json, "loadAnalysis", slug);
  if (payload == null) return null;
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
       FROM jds WHERE archived_at IS NULL ORDER BY created_at DESC LIMIT ?`
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
  // Archived rows still load (W8-4): the public page renders them with a
  // banner so existing analysis/report links never 404.
  const row = db
    .prepare(`SELECT slug, title, body, created_at, archived_at FROM jds WHERE slug = ?`)
    .get(slug) as JdRow | undefined;
  return row ?? null;
}

/** Edit a saved JD in place (W8-4/JDL1 — the library was fully append-only, so
 *  every revision forked a permanent near-duplicate and orphaned the analysis
 *  history keyed on jd_slug). Caller validates via validateJdFields. */
export function updateJd(slug: string, input: { title: string; body: string }): boolean {
  const db = ensureDb();
  return db.prepare(`UPDATE jds SET title = ?, body = ? WHERE slug = ?`).run(input.title, input.body, slug).changes > 0;
}

/** Archive / unarchive a JD (W8-4). Archived JDs leave listJds and the
 *  pickers; their public page stays up with a banner. */
export function setJdArchived(slug: string, archived: boolean): boolean {
  const db = ensureDb();
  return (
    db
      .prepare(`UPDATE jds SET archived_at = ? WHERE slug = ?`)
      .run(archived ? new Date().toISOString() : null, slug).changes > 0
  );
}

type CacheRow = {
  hash: string;
  payload_json: string;
  prompt_version: string;
  expires_at: string;
};

// Fraction of cache writes that also trigger an opportunistic prune. Combined
// with the boot prune in ensureDb, this keeps the prompt cache bounded on a
// long-running deployment without any scheduler dependency — every distinct
// analyze input adds a row, so spreading the GC across writes amortizes it.
const CACHE_PRUNE_PROBABILITY = 0.02;

// Generic prompt cache (analyze, per-match reasoning, automation tasks). The
// backing table is named `gemini_cache` for historical reasons — the real
// provider is ClaudeCliProvider, not Gemini — kept as-is to avoid orphaning the
// cached rows on existing deployments; the function names carry the accurate name.
export function lookupPromptCache(hash: string, promptVersion: string): unknown | null {
  const db = ensureDb();
  const row = db
    .prepare(
      `SELECT hash, payload_json, prompt_version, expires_at
       FROM gemini_cache WHERE hash = ?`
    )
    .get(hash) as CacheRow | undefined;
  if (!row) return null;
  if (row.prompt_version !== promptVersion) return null;
  // Fail closed: a non-finite parsed expiry (corruption, a bad migration default,
  // a manual edit) counts as already-expired, so a garbage timestamp self-heals into
  // a harmless miss instead of being served as an indefinitely-stale cache HIT.
  const expiresAt = Date.parse(row.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return null;
  // A corrupt cache payload logs (with the hash) and reads as a miss, same as a
  // miss — never an error served as a 200.
  return safeRowParse(row.payload_json, "lookupPromptCache", hash);
}

export function storePromptCache(
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
  // Opportunistic GC on a small fraction of writes so expired rows are
  // reclaimed during normal operation, not only at boot. Best-effort: a prune
  // failure must never fail the write that just succeeded.
  if (Math.random() < CACHE_PRUNE_PROBABILITY) {
    try {
      // Bound the opportunistic prune: it fires on a user-facing write path, so an
      // unbounded DELETE over a large expired backlog would hold the write lock for
      // seconds and stall (SQLITE_BUSY) concurrent storePromptCache/scheduler writes.
      // The boot prune stays unbounded but runs off the hot path.
      prunePromptCache(500);
    } catch (error) {
      console.error("[db] prompt-cache opportunistic prune failed", error);
    }
  }
}

export function prunePromptCache(limit?: number): number {
  const db = ensureDb();
  const now = new Date().toISOString();
  const result =
    limit && limit > 0
      ? db
          .prepare(`DELETE FROM gemini_cache WHERE rowid IN (SELECT rowid FROM gemini_cache WHERE expires_at < ? LIMIT ?)`)
          .run(now, limit)
      : db.prepare(`DELETE FROM gemini_cache WHERE expires_at < ?`).run(now);
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
  const jobs = loadSeedArray<JobRecord>("jobs", SEED_JOBS_PATH);
  if (!jobs) return;
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

/** Batch getJob (idea-f946db9d): one IN-query — chunked under the SQLite
 *  variable limit, same pattern as interviewStatusByEntries — instead of one
 *  point SELECT per id. Returns records in the REQUESTED order; unknown ids and
 *  corrupt payloads (logged by safeRowParse) are skipped, matching getJob's
 *  per-row degradation. */
export function getJobsByIds(ids: string[]): JobRecord[] {
  if (ids.length === 0) return [];
  const db = ensureDb();
  const byId = new Map<string, JobRecord>();
  for (const part of chunk(ids, SQL_IN_CHUNK)) {
    const placeholders = part.map(() => "?").join(",");
    const rows = db
      .prepare(`SELECT id, payload_json FROM jobs WHERE id IN (${placeholders})`)
      .all(...part) as { id: string; payload_json: string }[];
    for (const r of rows) {
      const parsed = safeRowParse<JobRecord>(r.payload_json, "getJobsByIds", r.id);
      if (parsed) byId.set(r.id, parsed);
    }
  }
  return ids.map((id) => byId.get(id)).filter((j): j is JobRecord => j !== undefined);
}

// The full live job corpus — every current opening rematch scores against. Unlike
// listJobs (paginated, filtered, ranked for the browse UI) this returns ALL live
// jobs as full records, ordered by id, with drafts excluded (an unpublished JD is
// not a real opening). It backs the rematch path two ways at once: the caller
// fingerprints the sorted ids into the cache key AND hands the exact same set to
// the Python scorer, so the key provably tracks the corpus that was scored
// (idea-e01935e9). NULL status = seeded/live corpus job; 'published' = live; only
// 'draft' is held back.
export function listCorpusJobs(): JobRecord[] {
  const db = ensureDb();
  const rows = db
    .prepare(`SELECT payload_json FROM jobs WHERE status IS NULL OR status != 'draft' ORDER BY id`)
    .all() as { payload_json: string }[];
  return rows
    .map((r) => safeRowParse<JobRecord>(r.payload_json, "listCorpusJobs"))
    .filter((j): j is JobRecord => j !== null);
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

// Like listProfiles but folds payload_json into the one query, so callers that
// need every payload (e.g. the candidate pool) don't fire an N+1 of getProfileRecord.
export function listProfileRecords(limit = 100): { row: ProfileRow; payload: unknown }[] {
  const db = ensureDb();
  const rows = db
    .prepare(
      `SELECT id, label, archetype, role_family, completeness, payload_json, created_at
       FROM profiles ORDER BY created_at DESC LIMIT ?`
    )
    .all(limit) as (ProfileRow & { payload_json: string })[];
  const out: { row: ProfileRow; payload: unknown }[] = [];
  for (const r of rows) {
    const { payload_json, ...rest } = r;
    const payload = safeRowParse(payload_json, "listProfileRecords", rest.id);
    if (payload == null) continue; // corrupt row already logged by safeRowParse; degrade to N-1
    out.push({ row: rest, payload });
  }
  return out;
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
  const { payload_json, ...rest } = row;
  const payload = safeRowParse(payload_json, "getProfileRecord", rest.id);
  if (payload == null) return null;
  return { row: rest, payload };
}

// Overwrite an existing profile in place (created_at is preserved so the roster
// keeps its order; the payload is the freshly re-routed/re-scored profile from
// profile_cli). Returns false when no row matched the id.
export function updateProfile(id: string, input: SaveProfileInput): boolean {
  const db = ensureDb();
  const info = db
    .prepare(
      `UPDATE profiles SET label = ?, archetype = ?, role_family = ?, completeness = ?, payload_json = ?
       WHERE id = ?`
    )
    .run(input.label, input.archetype, input.roleFamily, input.completeness, JSON.stringify(input.payload), id);
  return Number(info.changes) > 0;
}

// Returns false when no row matched the id. Pipeline entries reference a profile
// by candidateId but hold their own denormalized label/archetype, so a delete
// here does not cascade — an already-converted candidate stays in the pipeline.
export function deleteProfile(id: string): boolean {
  const db = ensureDb();
  const info = db.prepare(`DELETE FROM profiles WHERE id = ?`).run(id);
  return Number(info.changes) > 0;
}

// Seed the synthetic candidate population into `profiles`, so Profile / Match /
// Pipeline show an enterprise-like load.
const SEED_CANDIDATES_PATH = path.join(process.cwd(), "data", "seed_candidates", "candidates.json");
// Stable, deliberately-old timestamp for seeded candidate rows (see seedAnalyses):
// upserting every boot stays idempotent, and any profile the recruiter builds
// (created "now", random slug) sorts ahead of the seeds.
const SEED_CANDIDATE_CREATED_AT = "2024-01-01T00:00:00.000Z";

function seedCandidates(db: Database.Database): void {
  // UPSERTS the `cand-*` rows on every boot (no empty-table guard) so regenerating
  // the committed candidate seed — e.g. after the ČS skill alignment — refreshes
  // the profiles pool without a DB reset. Recruiter-built profiles use random,
  // non-`cand-` slugs, so they are never touched or replaced.
  const records = loadSeedArray<Record<string, unknown>>("candidates", SEED_CANDIDATES_PATH);
  if (!records) return;
  const insert = db.prepare(
    `INSERT OR REPLACE INTO profiles (id, label, archetype, role_family, completeness, payload_json, created_at)
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
        created_at: SEED_CANDIDATE_CREATED_AT,
      });
    }
  });
  tx(records);
}

// Seed deterministic CV analyses for the synthetic candidates into `analyses` on
// first boot, so the Profile candidate matrix (and Match's saved-analysis source)
// show analyzed candidates without anyone running the LLM Analyze flow. Generated
// by `python -m pipeline.jobfit.seed_analyses` from the same candidate seed; each
// payload is a schema-valid AnalysisResult, so /history/<slug> renders it like a
// real run. Stable `seed-<id>` slugs keep the links idempotent across reseeds.
const SEED_ANALYSES_PATH = path.join(process.cwd(), "data", "seed_analyses", "analyses.json");

// Stable, deliberately-old timestamp for seed rows: refreshing them every boot
// stays idempotent (no reordering), and any real analysis the recruiter runs
// (created "now") sorts ahead of the seeds in the history/matrix.
const SEED_ANALYSIS_CREATED_AT = "2024-01-01T00:00:00.000Z";

function seedAnalyses(db: Database.Database): void {
  // Unlike the one-shot seeders, this UPSERTS the `seed-<id>` rows on every boot
  // (no empty-table guard) so regenerating the committed JSON — e.g. after the
  // analysis shape grows — refreshes the seeded analyses without a DB reset. Real
  // analyses use random, non-`seed-` slugs, so they are never touched or replaced.
  const records = loadSeedArray<Record<string, unknown>>("analyses", SEED_ANALYSES_PATH);
  if (!records) return;
  const insert = db.prepare(
    `INSERT OR REPLACE INTO analyses (slug, candidate_label, jd_slug, score, role_family, seniority, payload_json, created_at)
     VALUES (@slug, @candidate_label, @jd_slug, @score, @role_family, @seniority, @payload_json, @created_at)`
  );
  const tx = db.transaction((rows: Array<Record<string, unknown>>) => {
    for (const rec of rows) {
      const id = rec.id as string;
      if (!id || !rec.payload) continue;
      insert.run({
        slug: `seed-${id}`,
        candidate_label: (rec.candidate_label as string) || id,
        jd_slug: null,
        score: (rec.score as number) ?? null,
        role_family: (rec.role_family as string) ?? null,
        seniority: (rec.seniority as string) ?? null,
        payload_json: JSON.stringify(rec.payload),
        created_at: SEED_ANALYSIS_CREATED_AT,
      });
    }
  });
  tx(records);
}

// ---- Hiring pipeline (Phase 10) -------------------------------------------

// The canonical stage axis + the archetype-fairness predicate live in the pure,
// DB-free pipeline-stages module (so the metric is unit-testable). Re-exported here
// so existing `import { PIPELINE_STAGES } from "./db"` call sites keep working.
import {
  PIPELINE_STAGES,
  FUNNEL_STAGES,
  SCREENING_STAGES,
  hasAdvancedPastScreening,
  isScreeningStage,
  screenStageOutcome,
  type PipelineStage,
  type FunnelStage,
  type ScreeningStage,
} from "./pipeline-stages";
export { PIPELINE_STAGES, FUNNEL_STAGES, SCREENING_STAGES, hasAdvancedPastScreening, isScreeningStage, screenStageOutcome };
export type { PipelineStage, FunnelStage, ScreeningStage };

// Legacy → consolidated stage mapping, applied to persisted rows + the seed.
export const LEGACY_STAGE_MAP: Record<string, PipelineStage> = {
  Sourced: "Accepted",
  "AI-matched": "Screened",
  Screening: "Screened",
};

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
  // Typed against the documented approval taxonomy (app/_lib/approval-kinds).
  approvalKind: ApprovalKind | null;
  approvalDetail: string | null;
  createdAt: string | null;
  stageChangedAt: string | null;
  // True when intake could not be normalized into a matchable profile and the
  // entry is a label-only stub needing manual capture; reason holds the (bounded)
  // failure detail. See createPipelineEntry / clearIntakeDegraded.
  intakeDegraded: boolean;
  intakeDegradedReason: string | null;
  // Candidate contact (email/phone) captured at inbound apply, else null. The
  // deliverable comms recipient when present (see candidateRecipient).
  contact: string | null;
  // Compact GitHub evidence summary captured at add-to-pipeline (GH2), else
  // null. Bounded by coerceGithubEvidenceSummary on both write and read.
  githubEvidence: GithubEvidenceSummary | null;
};

// Canonical shape of a /api/pipeline row. That endpoint returns listPipeline()
// (PipelineEntry[]) verbatim, so this IS the client-facing view contract. Client
// consumers (SimulationProvider, ChannelsTab) import this with `import type`
// instead of re-declaring divergent, partial local row types — those drift
// silently from the server the moment a field is renamed. (`import type` is
// erased at compile time, so no server code enters the client bundle.)
export type PipelineEntryView = PipelineEntry;

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

export function listPipelineEvents(limit = 40, offset = 0): PipelineEvent[] {
  const db = ensureDb();
  const rows = db
    .prepare(
      `SELECT id, entry_id, candidate_label, job_title, archetype, kind, from_stage, to_stage, detail, created_at
       FROM pipeline_events ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`
    )
    .all(limit, offset) as Array<{
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

/** Every event for ONE entry, OLDEST-FIRST — the candidate's story (applied →
 *  screened → advanced → scheduled → …) for the drawer's per-candidate history
 *  (PIPE3). Full detail (kind/from-to stage/detail), unlike the anonymized public
 *  activity feed: this is keyed by the internal entry id a recruiter surface
 *  already holds, so it's the same recruiter-data posture as /api/interview/by-entry. */
export function listPipelineEventsForEntry(entryId: string, limit = 50): PipelineEvent[] {
  const db = ensureDb();
  const rows = db
    .prepare(
      `SELECT id, entry_id, candidate_label, job_title, archetype, kind, from_stage, to_stage, detail, created_at
       FROM pipeline_events WHERE entry_id = ? ORDER BY created_at ASC, id ASC LIMIT ?`
    )
    .all(entryId, limit) as Array<{
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

/** Events strictly newer than `sinceId`, OLDEST-FIRST (idea-85f043ea). The
 *  AUTOINCREMENT primary key is the cursor — monotonic, gap-tolerant, immune to
 *  same-millisecond created_at ties. Oldest-first with a bounded LIMIT is the
 *  loss-free contract: when a burst outruns the limit, the caller still gets
 *  the OLDEST pending events and advances its cursor to the last id returned,
 *  catching up across polls — a newest-first LIMIT would silently drop the
 *  middle of the burst, which is exactly the bug this replaces. */
export function listPipelineEventsSince(sinceId: number, limit = 200): PipelineEvent[] {
  const db = ensureDb();
  const rows = db
    .prepare(
      `SELECT id, entry_id, candidate_label, job_title, archetype, kind, from_stage, to_stage, detail, created_at
       FROM pipeline_events WHERE id > ? ORDER BY id ASC LIMIT ?`
    )
    .all(sinceId, limit) as Array<{
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

// Total recorded events — lets the decision-log endpoint compute `hasMore`
// without over-fetching, so the UI can page through the full audit trail.
export function countPipelineEvents(): number {
  const db = ensureDb();
  const row = db.prepare(`SELECT COUNT(*) AS n FROM pipeline_events`).get() as { n: number };
  return row.n;
}

const SEED_PIPELINE_PATH = path.join(process.cwd(), "data", "seed_pipeline", "pipeline.json");

// Remap any persisted legacy 7-stage rows (and their event trail) to the
// consolidated 5-stage model. Idempotent — once remapped the old strings no
// longer match — so it's safe to run on every boot.
function migratePipelineStages(db: Database.Database): void {
  const updEntry = db.prepare(`UPDATE pipeline_entries SET stage = ? WHERE stage = ?`);
  const updTo = db.prepare(`UPDATE pipeline_events SET to_stage = ? WHERE to_stage = ?`);
  const updFrom = db.prepare(`UPDATE pipeline_events SET from_stage = ? WHERE from_stage = ?`);
  db.transaction(() => {
    for (const [legacy, next] of Object.entries(LEGACY_STAGE_MAP)) {
      updEntry.run(next, legacy);
      updTo.run(next, legacy);
      updFrom.run(next, legacy);
    }
  })();
}

// Retroactively split candidate declines out of the overloaded `rejected` status
// (idea-275e251e). Before declines had their own status, offer-finalize wrote
// 'rejected' and left the real meaning in the `offer_declined` event — and,
// crucially, it logged NO `rejected` pipeline event (only a recruiter reject via
// actOnPipelineEntry does that). So a row that is `rejected`, carries an
// `offer_declined` event, and has NO `rejected` event was a candidate decline
// mislabeled by the old code — flip those to 'declined'. The `rejected`-event
// guard is what keeps a genuine recruiter reject (including the rare
// decline → re-add → reject sequence, which DOES log a `rejected` event)
// untouched. Deterministic and idempotent — once flipped the row no longer
// matches `status='rejected'` — so it is safe to run on every boot.
function backfillDeclinedStatus(db: Database.Database): void {
  db.prepare(
    `UPDATE pipeline_entries
        SET status = 'declined', updated_at = ?
      WHERE status = 'rejected'
        AND id IN (SELECT entry_id FROM pipeline_events WHERE kind = 'offer_declined' AND entry_id IS NOT NULL)
        AND id NOT IN (SELECT entry_id FROM pipeline_events WHERE kind = 'rejected' AND entry_id IS NOT NULL)`
  ).run(new Date().toISOString());
}

function seedPipeline(db: Database.Database): void {
  const count = db.prepare(`SELECT COUNT(*) AS n FROM pipeline_entries`).get() as { n: number };
  if (count.n > 0) return;
  const entries = loadSeedArray<PipelineEntry>("pipeline", SEED_PIPELINE_PATH);
  if (!entries) return;
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
        stage: e.stage ?? "Accepted",
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
        toStage: "Screened",
        createdAt,
      });
      if (e.stage !== "Accepted" && e.stage !== "Screened") {
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
  intake_degraded: number | null;
  intake_degraded_reason: string | null;
  contact: string | null;
  github_json?: string | null;
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
    // DB column is free-form TEXT (also written by the Python seed); narrow to the
    // documented union at the read boundary.
    approvalKind: r.approval_kind as ApprovalKind | null,
    approvalDetail: r.approval_detail,
    createdAt: r.created_at,
    stageChangedAt: r.stage_changed_at,
    // Stored as 0/1 (and absent on a SELECT that omits the column) — coerce to bool.
    intakeDegraded: r.intake_degraded === 1,
    intakeDegradedReason: r.intake_degraded_reason ?? null,
    contact: r.contact ?? null,
    githubEvidence: parseGithubEvidence(r.github_json, r.id),
  };
}

// GH2 — revive the per-entry GitHub evidence at the read boundary. Re-coerced
// on every read (same validator the POST boundary uses) so a corrupt or
// legacy-shaped column degrades to null, never an unbounded blob on the board
// payload. NULL column (the overwhelmingly common case) costs nothing.
function parseGithubEvidence(githubJson: string | null | undefined, entryId: string): GithubEvidenceSummary | null {
  if (!githubJson) return null;
  try {
    return coerceGithubEvidenceSummary(JSON.parse(githubJson));
  } catch (error) {
    console.error(`[db] corrupt github_json on pipeline entry "${entryId}"`, error);
    return null;
  }
}

// SQL list literal of the terminal statuses, e.g. ('rejected', 'declined'),
// derived from the taxonomy const so the active-pipeline filters can't drift from
// it. The values are trusted compile-time literals (never user input), so inlining
// them into the statement is injection-safe.
const TERMINAL_STATUS_SQL_LIST = `(${TERMINAL_ENTRY_STATUSES.map((s) => `'${s}'`).join(", ")})`;

export function listPipeline(): PipelineEntry[] {
  const db = ensureDb();
  const rows = db
    .prepare(
      // Exclude BOTH terminal states (recruiter `rejected` and candidate
      // `declined`) from the active pipeline view — this used to be a bare
      // `status != 'rejected'`, which leaked declined entries back into the board.
      `SELECT id, candidate_id, candidate_label, archetype, role_family, job_id, job_title,
              stage, match_score, status, approval_kind, approval_detail, created_at, stage_changed_at,
              intake_degraded, intake_degraded_reason
       FROM pipeline_entries WHERE status NOT IN ${TERMINAL_STATUS_SQL_LIST}
       ORDER BY job_title, match_score DESC`
    )
    .all() as PipelineRow[];
  return rows.map(rowToEntry);
}

// ---- Pipeline analytics (Insights tab) ------------------------------------
// Snapshot-based so it stays correct even when the event history is sparse: an
// entry "reached" every stage up to its current one; durations come from the
// created_at / stage_changed_at pair we already maintain.

export type PipelineAnalytics = {
  total: number;
  active: number;
  hired: number;
  // Two DISTINCT terminal closes (see pipeline-status.ts): `rejected` = the
  // company passed; `declined` = the candidate turned down an offer. Kept
  // separate so offer-acceptance / re-engagement metrics aren't muddied by
  // lumping candidate declines into recruiter rejects.
  rejected: number;
  declined: number;
  funnel: { stage: string; reached: number; current: number; conversionPct: number | null }[];
  avgTimeToHireDays: number | null;
  avgAgeDays: number | null;
  bottleneck: Bottleneck | null;
  byJob: { jobTitle: string; total: number; reachedInterview: number; hired: number; hireRatePct: number }[];
  // Distinct job count before the byJob cap, so the UI can show "top N of M".
  byJobTotal: number;
  byArchetype: { archetype: string; total: number; hired: number; advanceRatePct: number }[];
  // ANA2 — the window actually applied (null = all time), echoed so the client
  // renders the selector state from the server's answer, not its own request.
  windowDays: number | null;
  // ANA2 — weekly inflow/outcome trend from pipeline_events (see
  // analytics-momentum.ts for the series mapping and bucket semantics).
  momentum: MomentumWeek[];
  // ANA3 — automation-vs-human rollup over the same window, folded through the
  // shared decision-attribution map the DecisionLog badges use.
  automation: AutomationImpact;
};

// ANA2 — `windowDays` scopes the snapshot metrics to the COHORT of entries
// created in the last N days (entries with no created_at drop out of a windowed
// view); omitted/null keeps the historical all-time behavior. Cohort-by-entry —
// not event-replay — so every figure keeps its existing meaning, just over the
// recent population.
export function pipelineAnalytics(windowDays?: number | null): PipelineAnalytics {
  const db = ensureDb();
  const cutoffIso = windowDays ? new Date(Date.now() - windowDays * 86_400_000).toISOString() : null;
  const rows = (
    cutoffIso
      ? db
          .prepare(
            `SELECT job_title, archetype, stage, status, created_at, stage_changed_at
             FROM pipeline_entries WHERE created_at >= ?`
          )
          .all(cutoffIso)
      : db
          .prepare(`SELECT job_title, archetype, stage, status, created_at, stage_changed_at FROM pipeline_entries`)
          .all()
  ) as {
    job_title: string | null;
    archetype: string | null;
    stage: string;
    status: string;
    created_at: string | null;
    stage_changed_at: string | null;
  }[];

  // Index against FUNNEL_STAGES (= the 5 canonical stages, Accepted-first). The
  // by-job/by-archetype thresholds below compare against idxOf("Interview") /
  // idxOf("Screened") symbolically, so they stay correct if the axis shifts.
  const idxOf = (s: string) => FUNNEL_STAGES.indexOf(s as FunnelStage);
  const now = Date.now();
  const daysSince = (iso?: string | null): number | null => {
    if (!iso) return null;
    const ms = Date.parse(iso);
    // A blank/malformed timestamp parses to NaN; skip it rather than letting
    // NaN poison avgAgeDays / the bottleneck average downstream.
    return Number.isFinite(ms) ? Math.max(0, (now - ms) / 86_400_000) : null;
  };

  const total = rows.length;
  const hired = rows.filter((r) => r.stage === "Hired").length;
  // Now that declines carry their own status, `rejected` counts only company-side
  // passes; `declined` is the candidate-side close that used to be folded in.
  const rejected = rows.filter((r) => r.status === "rejected").length;
  const declined = rows.filter((r) => r.status === "declined").length;
  const active = rows.filter((r) => r.status === "active" && r.stage !== "Hired").length;

  const reached = FUNNEL_STAGES.map(() => 0);
  const current = FUNNEL_STAGES.map(() => 0);
  for (const r of rows) {
    const i = idxOf(r.stage);
    if (i < 0) continue;
    for (let k = 0; k <= i; k += 1) reached[k] += 1;
    if (r.status === "active") current[i] += 1;
  }
  const funnel = FUNNEL_STAGES.map((stage, i) => ({
    stage,
    reached: reached[i],
    current: current[i],
    conversionPct: i === 0 ? null : reached[i - 1] > 0 ? Math.round((reached[i] / reached[i - 1]) * 100) : null,
  }));

  const tth = rows
    .filter((r) => r.stage === "Hired" && r.created_at && r.stage_changed_at)
    .map((r) => (Date.parse(r.stage_changed_at as string) - Date.parse(r.created_at as string)) / 86_400_000)
    .filter((d) => d >= 0);
  const avgTimeToHireDays = tth.length ? Math.round(tth.reduce((a, b) => a + b, 0) / tth.length) : null;

  const ages = rows
    .filter((r) => r.status === "active" && r.created_at)
    .map((r) => daysSince(r.created_at))
    .filter((d): d is number => d != null);
  const avgAgeDays = ages.length ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : null;

  const perStageDays: Record<string, number[]> = {};
  for (const r of rows) {
    if (r.status !== "active" || r.stage === "Hired") continue;
    const d = daysSince(r.stage_changed_at ?? r.created_at);
    if (d != null) (perStageDays[r.stage] ??= []).push(d);
  }
  // Small-sample guard: a stage needs >= BOTTLENECK_MIN_SAMPLE active entries
  // before its average wait counts as a systemic bottleneck, so a lone stale
  // entry can't masquerade as a trend in the amber banner (idea-bdaf9b2c).
  const bottleneck = pickBottleneck(perStageDays);

  const jobMap = new Map<string, { total: number; reachedInterview: number; hired: number }>();
  for (const r of rows) {
    const key = r.job_title ?? "—";
    const m = jobMap.get(key) ?? { total: 0, reachedInterview: 0, hired: 0 };
    m.total += 1;
    if (idxOf(r.stage) >= idxOf("Interview")) m.reachedInterview += 1;
    if (r.stage === "Hired") m.hired += 1;
    jobMap.set(key, m);
  }
  // Cap the role table to the highest-volume jobs, but report the true distinct-job
  // count alongside it so the UI can say "top N of M" — a silently truncated table
  // would otherwise read as "these are all my roles" for larger orgs.
  const BY_JOB_CAP = 12;
  const byJobTotal = jobMap.size;
  const byJob = [...jobMap.entries()]
    .map(([jobTitle, m]) => ({
      jobTitle,
      total: m.total,
      reachedInterview: m.reachedInterview,
      hired: m.hired,
      hireRatePct: m.total ? Math.round((m.hired / m.total) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, BY_JOB_CAP);

  const archMap = new Map<string, { total: number; hired: number; advanced: number }>();
  for (const r of rows) {
    const key = r.archetype ?? "bau";
    const m = archMap.get(key) ?? { total: 0, hired: 0, advanced: 0 };
    m.total += 1;
    if (r.stage === "Hired") m.hired += 1;
    // "advanced past screening" = reached Interview or beyond (see
    // hasAdvancedPastScreening); a candidate AT Screened has not advanced past it.
    if (hasAdvancedPastScreening(r.stage)) m.advanced += 1;
    archMap.set(key, m);
  }
  const byArchetype = [...archMap.entries()]
    .map(([archetype, m]) => ({
      archetype,
      total: m.total,
      hired: m.hired,
      advanceRatePct: m.total ? Math.round((m.advanced / m.total) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total);

  // Momentum trend (ANA2): the windowed view shows ceil(window/7) weekly buckets
  // so the bars span exactly the period the rest of the page describes; all-time
  // shows the default trailing MOMENTUM_WEEKS. Events are fetched only for the
  // span the buckets cover (created_at is indexed).
  const momentumWeeks = windowDays ? Math.max(1, Math.ceil(windowDays / 7)) : MOMENTUM_WEEKS;
  const momentumCutoff = new Date(Date.now() - momentumWeeks * 7 * 86_400_000).toISOString();
  const momentumKindList = `(${MOMENTUM_EVENT_KINDS.map((k) => `'${k}'`).join(", ")})`; // compile-time literals
  const momentumRows = db
    .prepare(
      `SELECT kind, to_stage, created_at FROM pipeline_events
        WHERE created_at >= ? AND kind IN ${momentumKindList}`
    )
    .all(momentumCutoff) as { kind: string; to_stage: string | null; created_at: string }[];
  const momentum = weeklyMomentum(
    momentumRows.map((r) => ({ kind: r.kind, toStage: r.to_stage, createdAt: r.created_at })),
    { weeks: momentumWeeks }
  );

  // Automation impact (ANA3): one GROUP BY kind over the window (the fold
  // through the shared attribution map happens in pure, tested code), plus a
  // per-entry holds query — an entry counts RESOLVED when some decision event
  // (advance / reject / auto-reject) landed AFTER its first in-window hold.
  const kindCountRows = (
    cutoffIso
      ? db.prepare(`SELECT kind, COUNT(*) AS c FROM pipeline_events WHERE created_at >= ? GROUP BY kind`).all(cutoffIso)
      : db.prepare(`SELECT kind, COUNT(*) AS c FROM pipeline_events GROUP BY kind`).all()
  ) as { kind: string; c: number }[];
  const kindCounts = Object.fromEntries(kindCountRows.map((r) => [r.kind, r.c]));
  const holdRow = db
    .prepare(
      `SELECT COUNT(*) AS raised,
              SUM(EXISTS (
                SELECT 1 FROM pipeline_events e2
                 WHERE e2.entry_id = h.entry_id
                   AND e2.kind IN ('advanced', 'rejected', 'auto_rejected')
                   AND e2.created_at > h.first_hold
              )) AS resolved
         FROM (
           SELECT entry_id, MIN(created_at) AS first_hold
             FROM pipeline_events
            WHERE kind = 'screening_hold' AND entry_id IS NOT NULL
              ${cutoffIso ? "AND created_at >= ?" : ""}
            GROUP BY entry_id
         ) h`
    )
    .get(...(cutoffIso ? [cutoffIso] : [])) as { raised: number; resolved: number | null };
  const automation = summarizeAutomationImpact(kindCounts, {
    raised: holdRow.raised,
    resolved: holdRow.resolved ?? 0,
  });

  return {
    total,
    active,
    hired,
    rejected,
    declined,
    funnel,
    avgTimeToHireDays,
    avgAgeDays,
    bottleneck,
    byJob,
    byJobTotal,
    byArchetype,
    windowDays: windowDays ?? null,
    momentum,
    automation,
  };
}

// ---- Cross-entity search (SHELL1, the command palette) ---------------------

export type SearchHit = {
  type: "profile" | "entry" | "job" | "jd" | "analysis";
  // The navigation handle the client maps to a deep link per type: profile id,
  // entry id (label drives the board filter), job id, JD slug, analysis slug.
  id: string;
  label: string;
  sub: string | null;
};

// Escape LIKE wildcards in user input so "100%" searches for the literal string;
// queries below pair the pattern with ESCAPE '\'.
function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// One palette query across the five user-recallable entity tables. Plain LIKE
// over indexed-enough tables (all are small, capped per type) — newest rows
// first so the recently-touched record the recruiter is hunting for surfaces on
// top. Read-only; the route wraps it in safeJsonError.
export function searchEntities(query: string, limitPerType = 5): SearchHit[] {
  const db = ensureDb();
  const like = `%${escapeLike(query)}%`;
  const hits: SearchHit[] = [];

  const profiles = db
    .prepare(
      `SELECT id, label, archetype FROM profiles WHERE label LIKE ? ESCAPE '\\'
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(like, limitPerType) as { id: string; label: string; archetype: string | null }[];
  for (const p of profiles) hits.push({ type: "profile", id: p.id, label: p.label, sub: p.archetype });

  const entries = db
    .prepare(
      `SELECT id, candidate_label, job_title, stage FROM pipeline_entries
       WHERE candidate_label LIKE ? ESCAPE '\\' OR job_title LIKE ? ESCAPE '\\'
       ORDER BY updated_at DESC LIMIT ?`
    )
    .all(like, like, limitPerType) as { id: string; candidate_label: string; job_title: string | null; stage: string }[];
  for (const e of entries)
    hits.push({
      type: "entry",
      id: e.id,
      label: e.candidate_label,
      sub: [e.job_title, e.stage].filter(Boolean).join(" · ") || null,
    });

  const jobs = db
    .prepare(
      `SELECT id, title, company FROM jobs WHERE title LIKE ? ESCAPE '\\' OR company LIKE ? ESCAPE '\\'
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(like, like, limitPerType) as { id: string; title: string; company: string | null }[];
  for (const j of jobs) hits.push({ type: "job", id: j.id, label: j.title, sub: j.company });

  const jds = db
    .prepare(
      `SELECT slug, title FROM jds
       WHERE (title LIKE ? ESCAPE '\\' OR slug LIKE ? ESCAPE '\\') AND archived_at IS NULL
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(like, like, limitPerType) as { slug: string; title: string }[];
  for (const d of jds) hits.push({ type: "jd", id: d.slug, label: d.title, sub: d.slug });

  const analyses = db
    .prepare(
      `SELECT slug, candidate_label, score FROM analyses
       WHERE candidate_label LIKE ? ESCAPE '\\' OR slug LIKE ? ESCAPE '\\'
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(like, like, limitPerType) as { slug: string; candidate_label: string | null; score: number | null }[];
  for (const a of analyses)
    hits.push({
      type: "analysis",
      id: a.slug,
      label: a.candidate_label || a.slug,
      sub: a.score != null ? String(a.score) : null,
    });

  return hits;
}

// Prior pipeline outcomes per candidate — used by talent rediscovery to spot
// "silver medalists" (rejected/closed elsewhere) who fit a different role.
export type CandidateOutcome = { jobId: string | null; jobTitle: string | null; stage: string; status: string };

export function candidateOutcomes(): Map<string, CandidateOutcome[]> {
  const rows = ensureDb()
    .prepare(`SELECT candidate_id, job_id, job_title, stage, status FROM pipeline_entries WHERE candidate_id IS NOT NULL`)
    .all() as { candidate_id: string; job_id: string | null; job_title: string | null; stage: string; status: string }[];
  const m = new Map<string, CandidateOutcome[]>();
  for (const r of rows) {
    const arr = m.get(r.candidate_id) ?? [];
    arr.push({ jobId: r.job_id, jobTitle: r.job_title, stage: r.stage, status: r.status });
    m.set(r.candidate_id, arr);
  }
  return m;
}

// Interviewed candidates for a job, with their fixed-rubric scorecard — the
// input for side-by-side interview comparison. The per-competency evidence
// doubles as the transcript highlights.
export type InterviewedCandidate = {
  entryId: string | null;
  candidateLabel: string | null;
  // Canonical advance|hold|reject verdict, or null when the (completed) interview
  // has no scorecard. A present-but-malformed value is coerced to the safe `hold`
  // fallback (see app/_lib/interview-recommendation.ts), so the compare grid only
  // ever receives a legal verdict or a clean null.
  recommendation: InterviewRecommendation | null;
  summary: string | null;
  // Which rubric this candidate was scored on, so the compare view can render
  // each cohort against its own axes. Older (pre-v3) scorecards predate the
  // early-career rubric, so a missing value is correctly 'experienced'.
  scoringModel: string;
  confidence: { level: string; reason?: string } | null;
  ratings: ScorecardRating[];
  // Skills minted as observed-provenance evidence by THIS interview (the
  // case-grounded gates in live_case.observed_from_interview); empty when the
  // interview minted nothing. The compare grid stamps these — the single
  // highest-trust artifact the pipeline produces must be visible, not implicit.
  observedSkills: string[];
};

/** Which of these entries carry an event of `kind` (W8-5 — e.g. the durable
 *  outreach_sent markers backing the sourcing ranking's persisted state).
 *  Chunked IN query under the SQLite variable limit. */
export function entryIdsWithEvent(entryIds: string[], kind: string): Set<string> {
  const out = new Set<string>();
  if (entryIds.length === 0) return out;
  const db = ensureDb();
  for (const ids of chunk(entryIds, SQL_IN_CHUNK)) {
    const placeholders = ids.map(() => "?").join(",");
    const rows = db
      .prepare(`SELECT DISTINCT entry_id FROM pipeline_events WHERE kind = ? AND entry_id IN (${placeholders})`)
      .all(kind, ...ids) as { entry_id: string }[];
    for (const r of rows) out.add(r.entry_id);
  }
  return out;
}

/** All pipeline entries filed under a job (PREP1 — the compare grid unions the
 *  voice-interviewed cohort with human-scorecard-only entries from here). */
export function listEntriesForJob(jobId: string): PipelineEntry[] {
  const db = ensureDb();
  const rows = db
    .prepare(`SELECT * FROM pipeline_entries WHERE job_id = ? ORDER BY created_at ASC, id ASC`)
    .all(jobId) as PipelineRow[];
  return rows.map(rowToEntry);
}

export function interviewedForJob(jobId: string): InterviewedCandidate[] {
  const rows = ensureDb()
    .prepare(
      // Include completed interviews even when the scorecard is missing (empty
      // transcript or a synthesis failure) — they render with blank ratings so a
      // finished interview is visible for manual review rather than silently gone.
      `SELECT entry_id, candidate_label, scorecard_json, ended_at FROM interview_sessions
       WHERE job_id = ? AND status = 'completed'
       ORDER BY ended_at DESC`
    )
    .all(jobId) as {
    entry_id: string | null;
    candidate_label: string | null;
    scorecard_json: string | null;
    ended_at: string | null;
  }[];

  const seen = new Set<string>();
  const out: InterviewedCandidate[] = [];
  for (const r of rows) {
    const key = r.entry_id ?? r.candidate_label ?? String(out.length);
    if (seen.has(key)) continue; // latest interview per candidate
    seen.add(key);
    const sc: {
      recommendation?: string;
      summary?: string;
      scoringModel?: string;
      confidence?: { level: string; reason?: string };
      ratings?: InterviewedCandidate["ratings"];
      observedSkills?: unknown;
    } = safeRowParse(r.scorecard_json, "interviewedCandidates.scorecard", key) ?? {};
    out.push({
      entryId: r.entry_id,
      candidateLabel: r.candidate_label,
      recommendation: sc.recommendation != null ? coerceInterviewRecommendation(sc.recommendation) : null,
      summary: sc.summary ?? null,
      scoringModel: sc.scoringModel ?? "experienced",
      confidence: sc.confidence ?? null,
      ratings: Array.isArray(sc.ratings) ? sc.ratings : [],
      observedSkills: Array.isArray(sc.observedSkills) ? sc.observedSkills.map(String) : [],
    });
  }
  return out;
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
  // Mark a label-only stub created because intake normalization failed, with a
  // short human-readable reason. Defaults to not-degraded for normal additions.
  intakeDegraded?: boolean;
  intakeDegradedReason?: string | null;
  // Optional stable identity to key idempotency on when `candidateId` itself is
  // NOT stable across submissions. The conversational apply flow mints a fresh
  // profile id per submission, so keying the entry id on candidateId would let
  // the same person spawn unlimited Accepted rows for one role. When set, the
  // entry's primary key derives from this instead (the candidate_id column still
  // stores the real profile id), so repeat applies collapse onto one row. See
  // `applyDedupeKey` in apply-intake.ts. Recruiter/Match adds omit it and keep
  // the historical candidateId-keyed behavior.
  dedupeKey?: string | null;
  // Candidate contact (email/phone) from inbound apply; stored so downstream comms
  // are deliverable. Omitted by recruiter/Match adds (they carry no address).
  contact?: string | null;
  // Compact GitHub evidence summary (GH2) as validated JSON — the caller (the
  // pipeline POST route) coerces the shape before stringifying. Backfilled onto
  // an existing entry only when the column is still empty (evidence is additive;
  // a re-add must never silently overwrite earlier evidence).
  githubJson?: string | null;
};

// Idempotent: a (candidate, job) pair maps to one entry, so re-adding from Match
// or the recruiter view returns the existing row rather than duplicating it. When
// the caller supplies a `dedupeKey` (the apply flow does — candidateId is a fresh
// per-submission profile id there), the id keys on that stable value instead, so
// repeat applications dedup rather than piling up. Returns created:false when an
// entry already existed, letting the caller surface the repeat.
export function createPipelineEntry(input: CreatePipelineInput): { entry: PipelineEntry; created: boolean } {
  const db = ensureDb();
  const keySource = input.dedupeKey || input.candidateId;
  const id = `m-${keySource}-${input.jobId}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 90);
  const existing = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ?`).get(id) as PipelineRow | undefined;
  if (existing) {
    // A re-add carrying GitHub evidence backfills an entry that has none —
    // additive only, never an overwrite of evidence already attached.
    if (input.githubJson && !existing.github_json) {
      db.prepare(`UPDATE pipeline_entries SET github_json=?, updated_at=? WHERE id=?`).run(
        input.githubJson,
        new Date().toISOString(),
        id
      );
    }
    // re-surface a previously-closed candidate if a recruiter re-adds them —
    // either a company reject OR a candidate decline (both terminal; a re-add
    // means "let's reconsider them", which applies equally to a past decline).
    if (isTerminalEntryStatus(existing.status)) {
      db.prepare(`UPDATE pipeline_entries SET status='active', updated_at=? WHERE id=?`).run(
        new Date().toISOString(),
        id
      );
    }
    const row = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ?`).get(id) as PipelineRow;
    return { entry: rowToEntry(row), created: false };
  }
  const now = new Date().toISOString();
  const stage = input.stage ?? "Screened";
  const intakeDegraded = input.intakeDegraded ? 1 : 0;
  const intakeDegradedReason = input.intakeDegraded ? input.intakeDegradedReason ?? "intake normalization failed" : null;
  db.prepare(
    `INSERT INTO pipeline_entries
       (id, candidate_id, candidate_label, archetype, role_family, job_id, job_title,
        stage, match_score, status, approval_kind, approval_detail, created_at, stage_changed_at, updated_at,
        intake_degraded, intake_degraded_reason, contact, github_json)
     VALUES (@id, @candidate_id, @candidate_label, @archetype, @role_family, @job_id, @job_title,
        @stage, @match_score, 'active', NULL, '', @now, @now, @now,
        @intake_degraded, @intake_degraded_reason, @contact, @github_json)`
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
    intake_degraded: intakeDegraded,
    intake_degraded_reason: intakeDegradedReason,
    contact: input.contact ?? null,
    github_json: input.githubJson ?? null,
  });
  recordEvent(db, {
    entryId: id,
    candidateLabel: input.candidateLabel,
    jobTitle: input.jobTitle,
    archetype: input.archetype,
    kind: intakeDegraded ? "intake_degraded" : "added",
    toStage: stage,
    detail: intakeDegraded ? intakeDegradedReason : "added to pipeline",
  });
  const row = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ?`).get(id) as PipelineRow;
  return { entry: rowToEntry(row), created: true };
}

// Duplicate-application policy lookup for the conversational apply flow: returns
// the EXISTING pipeline entry if this applicant has already applied to this role,
// else null. The flow captures no contact field, so a repeat is identified by
// (jobId + normalized applicant name) — the only stable signal we have. Matching
// is intentionally name-based and status-agnostic (an already-rejected or
// already-hired applicant re-applying is still a repeat to surface, not a new
// row): two genuinely distinct people who share a name applying to one role is an
// accepted, documented limitation of having no contact field.
//
// The earliest matching entry is returned so a repeat attaches its `re_applied`
// event to the original application (the canonical row). A blank name yields null
// — anonymous applicants can't be told apart, so they aren't merged. This is the
// primary, pre-build check the POST handler runs to avoid both a duplicate
// pipeline row AND a wasted profile build; createPipelineEntry's `dedupeKey`
// backstops the rare concurrent-submission race.
export function findApplicationByApplicant(jobId: string, name: string, email?: string | null): PipelineEntry | null {
  const emailKey = normalizeContact(email);
  const nameKey = normalizeApplicantName(name);
  // Nothing to key on (anonymous, no email) — never merge.
  if (!emailKey && !nameKey) return null;
  const db = ensureDb();
  const rows = db
    .prepare(`SELECT * FROM pipeline_entries WHERE job_id = ? ORDER BY created_at ASC, id ASC`)
    .all(jobId) as PipelineRow[];
  // When the applicant gave an email, identity is the EMAIL: a repeat is an entry
  // sharing that contact. A row holding a DIFFERENT address is never matched —
  // two real people who share a name but gave different addresses are different
  // applicants (the exact merge the old name-only match got wrong). When no email
  // was captured, fall back to the legacy (jobId + normalized name) match.
  //
  // W8-6 (APP1) upgrade path: when the email lookup misses, a same-named entry
  // with NO contact on file is still this applicant — their first application
  // simply predates their address (no-email applies are name-keyed). Without
  // this fallback the re-apply-with-email minted a SECOND row for the person who
  // was trying to become reachable. Restricted to contactless rows only, so the
  // different-address doctrine above is untouched.
  const match = emailKey
    ? rows.find((r) => normalizeContact(r.contact) === emailKey) ??
      (nameKey
        ? rows.find((r) => !normalizeContact(r.contact) && normalizeApplicantName(r.candidate_label) === nameKey)
        : undefined)
    : rows.find((r) => normalizeApplicantName(r.candidate_label) === nameKey);
  return match ? rowToEntry(match) : null;
}

// W8-6 (APP1) — fold a re-application's fresh signals onto the applicant's
// ORIGINAL entry instead of discarding them. Two independent, guarded updates:
//   - contact is BACKFILL-ONLY (SQL-guarded, same FILL-ONLY discipline as
//     setEntryMatchScore): an entry that already has an address keeps it — a
//     repeat with a different address never reaches here anyway (it's a new
//     applicant per findApplicationByApplicant).
//   - candidateId re-points the entry at a rebuilt profile and clears the
//     intake-degraded flag (the rebuild succeeding IS the recovery); archetype
//     refreshes alongside when the rebuild produced one.
// Records NO event — the caller logs ONE `re_applied` event whose detail says
// what merged, so the feed shows a single line per repeat. Returns the updated
// entry, or null when the id is unknown.
export function mergeReapplication(
  id: string,
  updates: { contact?: string | null; candidateId?: string | null; archetype?: string | null }
): PipelineEntry | null {
  const db = ensureDb();
  const now = new Date().toISOString();
  if (updates.contact) {
    db.prepare(
      `UPDATE pipeline_entries SET contact = ?, updated_at = ? WHERE id = ? AND (contact IS NULL OR contact = '')`
    ).run(updates.contact, now, id);
  }
  if (updates.candidateId) {
    db.prepare(
      `UPDATE pipeline_entries
         SET candidate_id = ?, archetype = COALESCE(?, archetype),
             intake_degraded = 0, intake_degraded_reason = NULL, updated_at = ?
       WHERE id = ?`
    ).run(updates.candidateId, updates.archetype ?? null, now, id);
  }
  const row = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ?`).get(id) as PipelineRow | undefined;
  return row ? rowToEntry(row) : null;
}

// Recruiter resolution of a degraded-intake stub: once the profile has been
// captured manually the flag is cleared and an event logged, so the audit trail
// shows the gap was recovered rather than the entry silently slipping through.
// Returns the updated entry, or null when the id is unknown or wasn't degraded.
export function clearIntakeDegraded(id: string): PipelineEntry | null {
  const db = ensureDb();
  const row = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ?`).get(id) as PipelineRow | undefined;
  if (!row || row.intake_degraded !== 1) return null;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE pipeline_entries SET intake_degraded=0, intake_degraded_reason=NULL, updated_at=? WHERE id=?`
  ).run(now, id);
  recordEvent(db, {
    entryId: id,
    candidateLabel: row.candidate_label,
    jobTitle: row.job_title,
    archetype: row.archetype,
    kind: "intake_resolved",
    toStage: row.stage,
    detail: "intake captured manually",
  });
  const updated = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ?`).get(id) as PipelineRow;
  return rowToEntry(updated);
}

// ---- Automation helpers (Phase 15) ----------------------------------------

// SINGLE SOURCE for the "don't stomp a fresh screening decision" window. Task 7
// (the policy pass) must never override a screening decision made within this many
// hours; `recentScreening` below flags entries with a `screening_*` event newer than
// the cutoff so the pass skips them. The Python boundary (automation.evaluate_entry)
// only receives the opaque `recentScreening` boolean and documents this contract —
// it cannot see the number — so this constant is the one place the window is defined.
export const SCREENING_OVERRIDE_GUARD_HOURS = 24;

export type AutomationEntry = PipelineEntry & { daysInStage: number; recentScreening: boolean };

export function getPipelineEntry(id: string): PipelineEntry | null {
  const db = ensureDb();
  const row = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ?`).get(id) as PipelineRow | undefined;
  return row ? rowToEntry(row) : null;
}

/** Active entries enriched with daysInStage + whether a screening decision is newer than
 *  SCREENING_OVERRIDE_GUARD_HOURS (the recentScreening guard, Task 7 input). */
export function listActiveEntriesForAutomation(): AutomationEntry[] {
  const db = ensureDb();
  const rows = db
    .prepare(
      `SELECT id, candidate_id, candidate_label, archetype, role_family, job_id, job_title,
              stage, match_score, status, approval_kind, approval_detail, created_at, stage_changed_at,
              intake_degraded, intake_degraded_reason
       FROM pipeline_entries WHERE status = 'active'`
    )
    .all() as PipelineRow[];
  const cutoff = new Date(Date.now() - SCREENING_OVERRIDE_GUARD_HOURS * 3600 * 1000).toISOString();
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

/** Fill an entry's missing match score (AUTO1 — the auto-score sweep). FILL-ONLY:
 *  the WHERE clause refuses to clobber a score already present (entry creation,
 *  a recruiter's re-file), so the sweep can never overwrite a human-era value. */
export function setEntryMatchScore(entryId: string, score: number): boolean {
  const db = ensureDb();
  const res = db
    .prepare(`UPDATE pipeline_entries SET match_score=?, updated_at=? WHERE id=? AND match_score IS NULL`)
    .run(score, new Date().toISOString(), entryId);
  return res.changes > 0;
}

/** Set/clear a pending approval without a stage change (Task 1 hold, Task 5 scorecard gate). */
export function setApproval(entryId: string, approvalKind: ApprovalKind | null, approvalDetail: string): void {
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

/** True if an event of this kind was EVER logged for the entry (unbounded). Used
 *  to make a real-world side effect idempotent across a multi-day window — e.g. a
 *  cached outreach draft (7-day prompt-cache TTL) must not re-deliver, where the
 *  per-day hasEventToday would let a resend slip through after midnight. */
export function hasEvent(entryId: string, kind: string): boolean {
  const db = ensureDb();
  return !!db
    .prepare(`SELECT 1 FROM pipeline_events WHERE entry_id=? AND kind=? LIMIT 1`)
    .get(entryId, kind);
}

// Per-day alert dedup is bucketed by the BUSINESS timezone, not UTC: kp serves the
// Czech market (CET/CEST), and bucketing by UTC midnight reset "once per day" at
// ~01:00–02:00 local, so an aging/stale/fairness alert could fire twice in a single
// local evening. Intl handles DST. Override the zone with BUSINESS_TZ.
const BUSINESS_TZ = process.env.BUSINESS_TZ || "Europe/Prague";
function businessDay(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** True if an event of this kind for the entry was already logged today (in the
 *  business timezone, BUSINESS_TZ) — alert dedup. Compares the local-date of the
 *  most recent matching event to today's local-date, so the once-per-day window
 *  aligns with the operator's day rather than UTC midnight. */
export function hasEventToday(entryId: string, kind: string): boolean {
  const db = ensureDb();
  const row = db
    .prepare(`SELECT created_at FROM pipeline_events WHERE entry_id=? AND kind=? ORDER BY created_at DESC LIMIT 1`)
    .get(entryId, kind) as { created_at: string } | undefined;
  return !!row && businessDay(row.created_at) === businessDay(new Date().toISOString());
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
  // DISTINCT on the (job_id, title, role_family) tuple is NOT distinct by position:
  // one job_id recorded with two titles/families (a title edited between pipeline
  // adds) surfaces the SAME id twice → duplicate matrix columns and duplicate React
  // keys downstream. Collapse on the stable job_id here, the single source of truth.
  // Order so the most-recently recorded row comes first (created_at desc — NULLs sort
  // last in SQLite — with id desc as a deterministic tiebreak) and keep the first per
  // id, so an edited title wins deterministically rather than picking an arbitrary row.
  const rows = db
    .prepare(
      `SELECT job_id AS id, job_title AS title, role_family AS roleFamily
       FROM pipeline_entries
       WHERE job_id IS NOT NULL
       ORDER BY created_at DESC, id DESC`
    )
    .all() as { id: string; title: string; roleFamily: string | null }[];
  const byId = new Map<string, { id: string; title: string; roleFamily: string | null }>();
  for (const r of rows) if (!byId.has(r.id)) byId.set(r.id, r);
  // Columns are presented alphabetically by title, preserving the prior ORDER BY job_title.
  return [...byId.values()].sort((a, b) => a.title.localeCompare(b.title));
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

// The live Background-tasks poll (GET /api/tasks fires every 2s while a task is
// active) and the history pager render only a task's status, label, progress and
// timing — never its result or params. A finished analyze/group_eval row carries
// multi-MB result_json/params_json, so SELECT * + re-parsing them for up to 60
// rows on every tick turns a lightweight status poll into a recurring multi-MB
// transfer and JSON re-parse, shipped to every connected client. List queries
// therefore project ONLY these light columns and leave result/params null; the
// full blob is fetched on demand for ONE row via getTask (GET /api/tasks/[id]).
const TASK_LITE_COLUMNS =
  "id, kind, dedupe_key, label, status, error, progress_done, progress_total, progress_msg, created_at, started_at, finished_at";

type TaskLiteRow = Omit<TaskRow, "params_json" | "result_json">;

function rowToTaskLite(r: TaskLiteRow): TaskRecord {
  return {
    id: r.id,
    kind: r.kind,
    dedupeKey: r.dedupe_key,
    label: r.label,
    status: r.status as TaskStatus,
    params: null, // omitted from list payloads — fetch the full task by id
    result: null, // omitted from list payloads — fetch the full task by id
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
  try {
    db.prepare(
      `INSERT INTO tasks (id, kind, dedupe_key, label, status, params_json, created_at) VALUES (?, ?, ?, ?, 'queued', ?, ?)`
    ).run(id, kind, dedupeKey, label, JSON.stringify(params ?? null), new Date().toISOString());
  } catch (e) {
    // uq_tasks_active_dedupe (when present) makes dedup atomic across connections: a
    // concurrent writer already started an active task with this key, so return that
    // instead of inserting a duplicate. Re-throw anything that isn't the collision.
    if (dedupeKey && (e as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") {
      const existing = getActiveTaskByDedupe(dedupeKey);
      if (existing) return existing;
    }
    throw e;
  }
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

// The live Background-tasks view: every active (queued/running) task regardless
// of age — a long run started days ago must stay visible — plus tasks that
// finished on/after `sinceIso`. Older finished tasks are excluded here and paged
// in on demand via listTaskHistory, so the polled payload stays bounded. Result
// and params are projected out (see TASK_LITE_COLUMNS) so this hot poll never
// re-ships multi-MB blobs; callers fetch the full task by id when they need it.
export function listRecentTasks(sinceIso: string, limit = 60): TaskRecord[] {
  const db = ensureDb();
  const rows = db
    .prepare(
      `SELECT ${TASK_LITE_COLUMNS} FROM tasks
       WHERE status IN ('queued','running')
          OR COALESCE(finished_at, created_at) >= @since
       ORDER BY (CASE WHEN status IN ('queued','running') THEN 0 ELSE 1 END),
                CASE WHEN status IN ('queued','running') THEN created_at END ASC,
                finished_at DESC
       LIMIT @limit`
    )
    .all({ since: sinceIso, limit }) as TaskLiteRow[];
  return rows.map(rowToTaskLite);
}

// Finished tasks older than `beforeIso`, newest-first, offset-paged — the
// complement of listRecentTasks. Powers the on-demand history table so the full
// (potentially huge) trail is never loaded at once. The `< before` here and the
// `>= since` above share one cutoff at the call site, so no task is dropped
// between the two windows or shown in both.
// DATA6 — optional kind/status narrowing for the paged history. The clauses are
// fixed strings chosen by presence (never interpolated values — both filters
// bind as parameters), so the prepared-statement shape stays injection-safe.
export type TaskHistoryFilter = { kind?: string; status?: string };

function taskHistoryClauses(filter?: TaskHistoryFilter): { sql: string; params: Record<string, string> } {
  let sql = "";
  const params: Record<string, string> = {};
  if (filter?.kind) {
    sql += " AND kind = @kind";
    params.kind = filter.kind;
  }
  if (filter?.status) {
    sql += " AND status = @status";
    params.status = filter.status;
  }
  return { sql, params };
}

export function listTaskHistory(beforeIso: string, limit: number, offset: number, filter?: TaskHistoryFilter): TaskRecord[] {
  const db = ensureDb();
  const { sql, params } = taskHistoryClauses(filter);
  const rows = db
    .prepare(
      `SELECT ${TASK_LITE_COLUMNS} FROM tasks
       WHERE status NOT IN ('queued','running')
         AND COALESCE(finished_at, created_at) < @before${sql}
       ORDER BY COALESCE(finished_at, created_at) DESC, id DESC
       LIMIT @limit OFFSET @offset`
    )
    .all({ before: beforeIso, limit, offset, ...params }) as TaskLiteRow[];
  return rows.map(rowToTaskLite);
}

export function countTaskHistory(beforeIso: string, filter?: TaskHistoryFilter): number {
  const db = ensureDb();
  const { sql, params } = taskHistoryClauses(filter);
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM tasks
       WHERE status NOT IN ('queued','running')
         AND COALESCE(finished_at, created_at) < @before${sql}`
    )
    .get({ before: beforeIso, ...params }) as { n: number };
  return row.n;
}

export function markTaskRunning(id: string): void {
  const db = ensureDb();
  // Guard on a non-terminal status so a late / recovery-re-enqueued write can't
  // resurrect or restamp a canceled / interrupted / finished task (terminal is final).
  db.prepare(`UPDATE tasks SET status='running', started_at=? WHERE id=? AND status IN ('queued','running')`).run(new Date().toISOString(), id);
}

export function setTaskProgress(id: string, done: number, total: number, msg?: string): void {
  const db = ensureDb();
  // A straggler progress callback from a handler still running after cancel must not
  // write to the terminal row (stale "Screening…" text on a dead task).
  db.prepare(`UPDATE tasks SET progress_done=?, progress_total=?, progress_msg=? WHERE id=? AND status IN ('queued','running')`).run(done, total, msg ?? null, id);
}

// A task's result is arbitrary handler output, so JSON.stringify can throw (a
// circular reference) or quietly return undefined (a function/symbol-valued root).
// finishTask runs inside runOne's SUCCESS path, so an unguarded throw there is
// caught and re-records a genuinely succeeded — often costly — run as 'failed',
// dropping its output. Degrade a non-serializable result to a stored marker and
// preserve the real status instead. undefined (no result passed) still stores NULL.
function serializeResult(result: unknown): string | null {
  if (result === undefined) return null;
  try {
    const json = JSON.stringify(result);
    if (json === undefined) throw new Error("result is not JSON-representable");
    return json;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[db:task.result] unserializable result — stored a marker instead: ${reason}`);
    return JSON.stringify({ __unserializable: true, reason });
  }
}

export function finishTask(id: string, status: TaskStatus, opts: { result?: unknown; error?: string }): void {
  const db = ensureDb();
  db.prepare(`UPDATE tasks SET status=?, result_json=?, error=?, finished_at=? WHERE id=?`).run(
    status,
    serializeResult(opts.result),
    opts.error ?? null,
    new Date().toISOString(),
    id
  );
}

/**
 * On server boot the volatile in-process queue is gone, so any 'running' row was
 * orphaned mid-flight — its handler partially executed and cannot resume, so mark
 * it 'interrupted'. 'queued' rows are deliberately left alone: they never started,
 * ran no side effects, and are re-enqueued by the task runner (see listQueuedTaskIds)
 * instead of being silently abandoned. Returns the number of rows interrupted.
 */
export function interruptStaleTasks(): number {
  const db = ensureDb();
  const info = db
    .prepare(`UPDATE tasks SET status='interrupted', finished_at=? WHERE status='running'`)
    .run(new Date().toISOString());
  return info.changes as number;
}

/**
 * IDs of never-started ('queued') tasks, oldest first. After a restart these are
 * orphans of the volatile in-process queue but ran no handler, so the runner can
 * safely re-enqueue them in submission order rather than dropping the work.
 */
export function listQueuedTaskIds(): string[] {
  const db = ensureDb();
  const rows = db.prepare(`SELECT id FROM tasks WHERE status='queued' ORDER BY created_at ASC`).all() as { id: string }[];
  return rows.map((r) => r.id);
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
  // The role's AI-interview scenario generated from the approved case
  // (devcase/interview_scenario.py) — null until the lifecycle generates it.
  scenario: unknown;
  // The case's materialized seed ({files: [{path, contents}], note}) — null
  // until the lifecycle materializes it (devcase/seed_materializer.py).
  seed: unknown;
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
  scenario_json: string | null;
  seed_json: string | null;
  status: string;
  created_at: string;
};

function rowToDevCase(r: DevCaseRow): DevCaseRecord {
  return {
    id: r.id,
    title: r.title,
    roleTitle: r.role_title,
    seniority: r.seniority,
    need: safeRowParse(r.need_json, "devCase.need", r.id),
    analysis: safeRowParse(r.analysis_json, "devCase.analysis", r.id),
    role: safeRowParse(r.role_json, "devCase.role", r.id),
    case: safeRowParse(r.case_json, "devCase.case", r.id),
    scenario: safeRowParse(r.scenario_json, "devCase.scenario", r.id),
    seed: safeRowParse(r.seed_json, "devCase.seed", r.id),
    status: r.status,
    createdAt: r.created_at,
  };
}

/** Persist the case-designed interview scenario on its dev case (one per role). */
export function saveDevCaseScenario(id: string, scenario: unknown): void {
  const db = ensureDb();
  db.prepare(`UPDATE dev_cases SET scenario_json = ? WHERE id = ?`).run(JSON.stringify(scenario ?? null), id);
}

/** Persist the materialized seed (the concrete starter file tree) on its dev case. */
export function saveDevCaseSeed(id: string, seed: unknown): void {
  const db = ensureDb();
  db.prepare(`UPDATE dev_cases SET seed_json = ? WHERE id = ?`).run(JSON.stringify(seed ?? null), id);
}

export function saveDevCase(input: {
  need: unknown;
  analysis: unknown;
  role: { title?: string; seniority?: string } & Record<string, unknown>;
  case: { title?: string } & Record<string, unknown>;
}): { id: string; createdAt: string } {
  const db = ensureDb();
  const now = new Date().toISOString();
  const id = randomId("dc");
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

// The orchestrator branches on these payload fields, so they carry real shapes
// rather than `unknown` — a mismatch is then a compile error at the read site,
// not a runtime `undefined`. Each keeps an index signature: the Python design
// steps emit richer objects than the orchestrator reads, and those extra keys
// must round-trip through saveDevCase / the UI untouched.
//
// Reality-reflection output the auto-approve gate scores (statedVsRealGaps + confidence).
export type LifecycleAnalysis = { statedVsRealGaps?: string[]; confidence?: number } & Record<string, unknown>;
// Designed RoleSpec — title/seniority drive sourcing labels + candidate comms.
export type LifecycleRole = { title?: string; seniority?: string } & Record<string, unknown>;
// Designed CaseScenario (covert probes, rubric, tasks) — opaque to the orchestrator.
export type LifecycleCase = Record<string, unknown>;

export type LifecycleRecord = {
  id: string;
  title: string | null;
  stage: string;
  auto: boolean;
  // null only when the stored JSON is absent or corrupt (safeRowParse fell back).
  need: DevNeed | null;
  analysis: LifecycleAnalysis | null;
  role: LifecycleRole | null;
  case: LifecycleCase | null;
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
    need: safeRowParse<DevNeed>(r.need_json as string | null, "lifecycle.need", r.id as string),
    analysis: safeRowParse<LifecycleAnalysis>(r.analysis_json as string | null, "lifecycle.analysis", r.id as string),
    role: safeRowParse<LifecycleRole>(r.role_json as string | null, "lifecycle.role", r.id as string),
    case: safeRowParse<LifecycleCase>(r.case_json as string | null, "lifecycle.case", r.id as string),
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
  const id = randomId("lc");
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
  const set = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    vals.push(value);
  };
  if (patch.stage !== undefined) set("stage", patch.stage);
  if (patch.analysis !== undefined) set("analysis_json", JSON.stringify(patch.analysis));
  if (patch.role !== undefined) set("role_json", JSON.stringify(patch.role));
  if (patch.case !== undefined) set("case_json", JSON.stringify(patch.case));
  if (patch.caseId !== undefined) set("case_id", patch.caseId);
  if (patch.postingId !== undefined) set("posting_id", patch.postingId);
  if (patch.detail !== undefined) set("detail", patch.detail);
  vals.push(id);
  db.prepare(`UPDATE dev_lifecycle SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
}

// The one approve transition: persist the designed artifacts as a dev case and
// flip the lifecycle to "approved" in a SINGLE transaction. Both writes hit this
// connection, so wrapping them means a concurrent writer (another lifecycle task,
// an API handler) can never observe — nor a mid-sequence failure leave — a saved
// case with its lifecycle still stuck pre-approval. Shared by the orchestrator's
// auto-approve gate and the human-approve route; `detail` carries the path-specific
// reason and the caller records the (separate-connection) audit row after this
// returns. Returns the new case id.
export function approveLifecycleCase(
  id: string,
  lc: Pick<LifecycleRecord, "need" | "analysis" | "role" | "case">,
  detail: string
): { caseId: string } {
  const db = ensureDb();
  const caseId = db.transaction(() => {
    const saved = saveDevCase({
      need: lc.need,
      analysis: lc.analysis,
      role: lc.role ?? {},
      case: lc.case ?? {},
    });
    updateLifecycle(id, { stage: "approved", caseId: saved.id, detail });
    return saved.id;
  })();
  return { caseId };
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
    evaluation: safeRowParse(r.eval_json as string | null, "submission.eval", r.id as string),
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
  // Delivery status — the canonical three-state contract (see comms-status.ts).
  status: OutboxStatus;
  ref: string | null;
  createdAt: string;
};

export function recordOutbox(input: {
  recipient: string;
  subject: string;
  body: string;
  kind: string;
  channel: string;
  status: OutboxStatus;
  ref?: string | null;
}): OutboxEntry {
  const db = ensureDb();
  const now = new Date().toISOString();
  const id = randomId("out");
  db.prepare(
    `INSERT INTO dev_outbox (id, recipient, subject, body, kind, channel, status, ref, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, input.recipient, input.subject, input.body, input.kind, input.channel, input.status, input.ref ?? null, now);
  return { id, ...input, ref: input.ref ?? null, createdAt: now };
}

// ---- Interview sessions (voice 1st-round MVP) -----------------------------

// The provider union and transcript-turn shape are single-sourced in the voice
// adapter layer (app/_lib/voice/types): VoiceProviderId is the same union the
// create/connect routes validate with coerceProviderId, and VoiceTurn is the
// exact shape the browser POSTs on hang-up. Re-exported here so existing
// `import { ... } from "./db"` call sites resolve, and so the row mapper below
// cannot drift from the wire/client shape — the compiler now enforces it.
export type { VoiceProviderId, VoiceTurn } from "./voice/types";

export type InterviewSession = {
  id: string;
  token: string;
  entryId: string | null;
  candidateLabel: string | null;
  jobId: string | null;
  jobTitle: string | null;
  provider: VoiceProviderId;
  language: string | null;
  mode: "test" | "candidate";
  status: string;
  instructions: string | null;
  runOfShow: string[] | null;
  durationMin: number | null;
  consentAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  transcript: VoiceTurn[] | null;
  scorecard: unknown | null;
  createdAt: string;
  updatedAt: string | null;
};

type InterviewRow = {
  id: string;
  token: string;
  entry_id: string | null;
  candidate_label: string | null;
  job_id: string | null;
  job_title: string | null;
  provider: string;
  language: string | null;
  mode: string;
  status: string;
  instructions: string | null;
  run_of_show_json: string | null;
  duration_min: number | null;
  consent_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  transcript_json: string | null;
  scorecard_json: string | null;
  created_at: string;
  updated_at: string | null;
};

function rowToInterview(r: InterviewRow): InterviewSession {
  return {
    id: r.id,
    token: r.token,
    entryId: r.entry_id,
    candidateLabel: r.candidate_label,
    jobId: r.job_id,
    jobTitle: r.job_title,
    provider: coerceProviderId(r.provider, "openai"),
    language: r.language,
    mode: r.mode === "candidate" ? "candidate" : "test",
    status: r.status,
    instructions: r.instructions,
    runOfShow: safeRowParse<string[]>(r.run_of_show_json, "interview.runofshow", r.id),
    durationMin: r.duration_min,
    consentAt: r.consent_at,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    transcript: safeRowParse<VoiceTurn[]>(r.transcript_json, "interview.transcript", r.id),
    scorecard: safeRowParse<unknown>(r.scorecard_json, "interview.scorecard", r.id),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function createInterviewSession(input: {
  provider: VoiceProviderId;
  language?: string | null;
  mode?: "test" | "candidate";
  entryId?: string | null;
  candidateLabel?: string | null;
  jobId?: string | null;
  jobTitle?: string | null;
  instructions?: string | null;
  runOfShow?: string[] | null;
  durationMin?: number | null;
}): InterviewSession {
  const db = ensureDb();
  const now = new Date().toISOString();
  const id = randomId("iv");
  const token = randomToken("tk");
  db.prepare(
    `INSERT INTO interview_sessions
       (id, token, entry_id, candidate_label, job_id, job_title, provider, language, mode, status, instructions, run_of_show_json, duration_min, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'created', ?, ?, ?, ?)`
  ).run(
    id,
    token,
    input.entryId ?? null,
    input.candidateLabel ?? null,
    input.jobId ?? null,
    input.jobTitle ?? null,
    input.provider,
    input.language ?? null,
    input.mode ?? "test",
    input.instructions ?? null,
    input.runOfShow && input.runOfShow.length ? JSON.stringify(input.runOfShow) : null,
    input.durationMin ?? null,
    now
  );
  return getInterviewSessionById(id)!;
}

// W6-4 (VOX1) — delivered-link lifecycle. Links are auto-emailed on create, so
// a live, indefinitely-valid AI-interview credential sat in candidates'
// inboxes with no expiry, no revoke and no reissue semantics.
// How long an undelivered/untaken link stays valid. Only `created` sessions
// expire — an in_progress call is live, and completed/failed have their own
// terminal semantics (failed stays reconnectable on purpose).
export const INTERVIEW_LINK_TTL_DAYS = 7;

/** Single expiry authority for an interview link — shared by /connect (the
 *  credential gate) and the portal page so the two can never disagree. */
export function isInterviewLinkExpired(session: { status: string; createdAt: string }): boolean {
  return (
    session.status === "created" &&
    Date.parse(session.createdAt) < Date.now() - INTERVIEW_LINK_TTL_DAYS * 86_400_000
  );
}

/** Revoke one open interview session. Concurrency guard in the WHERE (repo
 *  convention): never touches completed (the transcript is evidence) and a
 *  re-revoke is a no-op. `failed` is revocable — reconnectable-by-design ends
 *  when the recruiter pulls the link. */
export function revokeInterviewSession(id: string): boolean {
  const db = ensureDb();
  const res = db
    .prepare(`UPDATE interview_sessions SET status='revoked' WHERE id = ? AND status IN ('created','in_progress','failed')`)
    .run(id);
  return res.changes > 0;
}

/** Revoke every open session for an entry — the reissue half (a fresh link
 *  kills prior ones) and the terminal-transition cleanup. Returns the count. */
export function revokeOpenInterviewSessions(entryId: string): number {
  const db = ensureDb();
  const res = db
    .prepare(`UPDATE interview_sessions SET status='revoked' WHERE entry_id = ? AND status IN ('created','in_progress','failed')`)
    .run(entryId);
  return res.changes;
}

/** Latest interview session per entry (for the Schedule tab indicator). */
export function interviewStatusByEntries(
  entryIds: string[]
): Record<string, { sessionId: string; status: string; hasTranscript: boolean; endedAt: string | null }> {
  if (entryIds.length === 0) return {};
  const out: Record<string, { sessionId: string; status: string; hasTranscript: boolean; endedAt: string | null }> = {};
  // Chunk the IN query under the SQLite variable limit so a wide board never trips
  // SQLITE_MAX_VARIABLE_NUMBER (idea-191ccc0c). Chunks partition the ids, so the
  // "first row per entry = latest" dedup below holds across chunk boundaries.
  for (const ids of chunk(entryIds, SQL_IN_CHUNK)) {
    const placeholders = ids.map(() => "?").join(",");
    const rows = ensureDb()
      .prepare(
        `SELECT s.id, s.entry_id, s.status, s.ended_at,
                (s.transcript_json IS NOT NULL AND s.transcript_json != '[]') AS has_tr
         FROM interview_sessions s
         WHERE s.entry_id IN (${placeholders})
         ORDER BY s.created_at DESC`
      )
      .all(...ids) as { id: string; entry_id: string; status: string; ended_at: string | null; has_tr: number }[];
    for (const r of rows) {
      if (out[r.entry_id]) continue; // first = latest (DESC)
      out[r.entry_id] = { sessionId: r.id, status: r.status, hasTranscript: !!r.has_tr, endedAt: r.ended_at };
    }
  }
  return out;
}

/** Most-recent interview session for one entry (for the transcript modal). */
export function latestInterviewByEntry(entryId: string): InterviewSession | null {
  const r = ensureDb()
    .prepare(`SELECT * FROM interview_sessions WHERE entry_id = ? ORDER BY created_at DESC LIMIT 1`)
    .get(entryId) as InterviewRow | undefined;
  return r ? rowToInterview(r) : null;
}

export function getInterviewSessionById(id: string): InterviewSession | null {
  const r = ensureDb().prepare(`SELECT * FROM interview_sessions WHERE id = ?`).get(id) as InterviewRow | undefined;
  return r ? rowToInterview(r) : null;
}

export function getInterviewSessionByToken(token: string): InterviewSession | null {
  const r = ensureDb().prepare(`SELECT * FROM interview_sessions WHERE token = ?`).get(token) as InterviewRow | undefined;
  return r ? rowToInterview(r) : null;
}

/** Mark a session live (first connect); records consent_at the first time it is
 *  given. /connect enforces consent for candidate-mode sessions before calling
 *  this (see interview-consent.ts), so the consent=false branch below now only
 *  applies to ungated test/lab runs.
 *
 *  The UPDATE never reopens a completed session (idea-836e08d8): it used to
 *  force status='in_progress' unconditionally, so a direct POST to /connect
 *  with a finished session's token reset it and minted fresh provider
 *  credentials — the portal page only blocked the RENDER. The guard lives in
 *  the WHERE clause so a /complete racing this call can't lose; returns whether
 *  the session actually went live so the route can refuse to mint credentials. */
export function markInterviewStarted(id: string, consent: boolean): boolean {
  const db = ensureDb();
  const now = new Date().toISOString();
  if (consent) {
    return (
      db
        .prepare(
          `UPDATE interview_sessions SET status='in_progress', started_at=COALESCE(started_at, ?), consent_at=COALESCE(consent_at, ?), updated_at=? WHERE id=? AND status != 'completed'`
        )
        .run(now, now, now, id).changes > 0
    );
  }
  return (
    db
      .prepare(
        `UPDATE interview_sessions SET status='in_progress', started_at=COALESCE(started_at, ?), updated_at=? WHERE id=? AND status != 'completed'`
      )
      .run(now, now, id).changes > 0
  );
}

/** Persist the end of a call. The UPDATE is guarded at the row level so a
 *  session that already reached 'completed' is never overwritten (idea-beb71894):
 *  a duplicate POST — a network retry, a second tab, or the ElevenLabs
 *  onDisconnect firing alongside a manual End across a reload — must not wipe
 *  the persisted transcript, the only durable artifact of the interview. The
 *  guard lives in the WHERE clause (not a read-then-write in the route) so two
 *  concurrent completions can't both pass a status check; `applied` tells the
 *  caller whether THIS call performed the write. A 'failed' session stays
 *  writable: a successful retry after a dropped call may upgrade it. */
export function completeInterviewSession(
  id: string,
  input: { transcript: VoiceTurn[]; scorecard?: unknown; status?: string }
): { session: InterviewSession | null; applied: boolean } {
  const db = ensureDb();
  const now = new Date().toISOString();
  const res = db
    .prepare(
      `UPDATE interview_sessions SET status=?, ended_at=?, transcript_json=?, scorecard_json=COALESCE(?, scorecard_json), updated_at=? WHERE id=? AND status != 'completed'`
    )
    .run(
      input.status ?? "completed",
      now,
      JSON.stringify(input.transcript ?? []),
      input.scorecard !== undefined ? JSON.stringify(input.scorecard) : null,
      now,
      id
    );
  return { session: getInterviewSessionById(id), applied: res.changes > 0 };
}

/** Attach the synthesized scorecard to an already-persisted session. Separate
 *  from completeInterviewSession so the transcript write can happen FIRST and
 *  scoring strictly after it (idea-55fd89f9) — a scoring step that sets the
 *  Interview→Offer approval must never run ahead of the durable transcript it
 *  scores. */
export function attachInterviewScorecard(id: string, scorecard: unknown): InterviewSession | null {
  const db = ensureDb();
  const now = new Date().toISOString();
  db.prepare(`UPDATE interview_sessions SET scorecard_json=?, updated_at=? WHERE id=?`).run(
    JSON.stringify(scorecard),
    now,
    id
  );
  return getInterviewSessionById(id);
}

function rowToOutboxEntry(r: Record<string, unknown>): OutboxEntry {
  return {
    id: r.id as string,
    recipient: (r.recipient as string) ?? null,
    subject: (r.subject as string) ?? null,
    body: (r.body as string) ?? null,
    kind: (r.kind as string) ?? null,
    channel: (r.channel as string) ?? null,
    // Normalize so legacy rows (e.g. "failed:500") and any stray value map to the
    // canonical enum — callers/UI can rely on exactly the three documented states.
    status: coerceOutboxStatus(r.status as string | null),
    ref: (r.ref as string) ?? null,
    createdAt: r.created_at as string,
  };
}

export function listOutbox(limit = 50): OutboxEntry[] {
  const db = ensureDb();
  const rows = db.prepare(`SELECT * FROM dev_outbox ORDER BY created_at DESC LIMIT ?`).all(limit) as Array<Record<string, unknown>>;
  return rows.map(rowToOutboxEntry);
}

/** One outbox row by id — the resend route's read (W6-1). */
export function getOutboxEntry(id: string): OutboxEntry | null {
  const db = ensureDb();
  const r = db.prepare(`SELECT * FROM dev_outbox WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  return r ? rowToOutboxEntry(r) : null;
}

/** Filterable outbox read (W6-1/SIM1) — per-candidate ("what did this person
 *  receive?"), per-status (dead-letter triage) and per-kind views for the Comms
 *  Center and the drawer's Messages section. All filters optional. */
export function listOutboxFiltered(opts: { ref?: string; status?: OutboxStatus; kind?: string; limit?: number }): OutboxEntry[] {
  const db = ensureDb();
  const where: string[] = [];
  const vals: unknown[] = [];
  if (opts.ref) {
    where.push("ref = ?");
    vals.push(opts.ref);
  }
  if (opts.status) {
    where.push("status = ?");
    vals.push(opts.status);
  }
  if (opts.kind) {
    where.push("kind = ?");
    vals.push(opts.kind);
  }
  vals.push(Math.min(Math.max(opts.limit ?? 100, 1), 500));
  const rows = db
    .prepare(
      `SELECT * FROM dev_outbox ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ?`
    )
    .all(...vals) as Array<Record<string, unknown>>;
  return rows.map(rowToOutboxEntry);
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
  const id = randomId("pst");
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
  const id = randomId("sub");
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

/** Flip a posting's status (W5-3: "closed" stops the apply page + inbound
 *  webhook from collecting submissions nobody will process). */
export function setPostingStatus(id: string, status: string): boolean {
  const db = ensureDb();
  return db.prepare(`UPDATE dev_postings SET status = ? WHERE id = ?`).run(status, id).changes > 0;
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

/** Apply a pipeline action. The read→compute→write runs inside an IMMEDIATE
 *  transaction (idea-b6310b92): the write lock is taken at BEGIN, so a write
 *  from another connection (offers-store, schedule-store, a second process)
 *  cannot land between the SELECT and the UPDATE — the classic lost-update
 *  where a stale automated 'advance' clobbers a human correction.
 *
 *  `opts.expectedStage` is the optimistic-CAS half for callers whose DECISION
 *  is older than the write (the automation pass snapshots entries, spawns
 *  Python for seconds, then applies): when the row's stage no longer matches
 *  what the decision was computed from, the action is SKIPPED and null is
 *  returned — a policy verdict about a stage the entry is no longer in must
 *  not be applied to whatever stage it is in now. */
export function actOnPipelineEntry(
  id: string,
  action: PipelineAction,
  detail?: string,
  opts?: { expectedStage?: string }
): PipelineEntry | null {
  const db = ensureDb();
  const tx = db.transaction((): PipelineEntry | null => {
  const row = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ?`).get(id) as PipelineRow | undefined;
  if (!row) return null;
  if (opts?.expectedStage !== undefined && row.stage !== opts.expectedStage) {
    console.warn(
      `[pipeline:act] skipped stale ${action} for entry ${id}: decided at stage '${opts.expectedStage}', row is now '${row.stage}'.`
    );
    return null;
  }
  const now = new Date().toISOString();
  const meta = {
    entryId: id,
    candidateLabel: row.candidate_label,
    jobTitle: row.job_title,
    archetype: row.archetype,
    fromStage: row.stage,
  };

  // A human decision may carry a free-text reason (DEC4). The detail/display
  // plumbing already existed end-to-end (route forwards body.detail; DecisionLog
  // renders d.detail) — accept/reject just never recorded it, so every human
  // advance/reject landed in the auditable log with a blank reason. Now the
  // optional reason rides the event. (approve_event keeps using detail as the slot.)
  const decisionNote = detail && detail.trim() ? detail.trim() : null;
  if (action === "reject") {
    db.prepare(`UPDATE pipeline_entries SET status='rejected', approval_kind=NULL, updated_at=? WHERE id=?`).run(now, id);
    recordEvent(db, { ...meta, kind: "rejected", toStage: row.stage, detail: decisionNote });
  } else if (action === "approve_event") {
    // A rejected/declined entry is terminal — a stale/reused schedule token must not
    // re-activate its approval or write a 'scheduled' event for a closed-out
    // candidate. (Hired keeps status 'active', so a legitimate reschedule still works.)
    if (isTerminalEntryStatus(row.status)) return null;
    // Honor a slot override (the shared calendar lets you move a candidate's
    // proposed time); fall back to the originally-proposed slot.
    const slot = detail && detail.trim() ? detail.trim() : row.approval_detail;
    // Scheduling advances Screening → Interview, but must never move backward: a
    // stale or reused schedule link confirmed after the candidate already reached
    // Offer/Hired records the slot without regressing their stage.
    const interviewIdx = PIPELINE_STAGES.indexOf("Interview");
    const curIdx = PIPELINE_STAGES.indexOf(row.stage as PipelineStage);
    const toStage = curIdx > interviewIdx ? row.stage : "Interview";
    if (toStage !== row.stage) {
      db.prepare(
        `UPDATE pipeline_entries SET stage=?, approval_kind=NULL, approval_detail='', stage_changed_at=?, updated_at=? WHERE id=?`
      ).run(toStage, now, now, id);
    } else {
      // Reschedule / already past Interview: clear the approval but leave
      // stage_changed_at untouched so time-in-stage and time-to-hire stay honest.
      db.prepare(
        `UPDATE pipeline_entries SET approval_kind=NULL, approval_detail='', updated_at=? WHERE id=?`
      ).run(now, id);
    }
    recordEvent(db, { ...meta, kind: "scheduled", toStage, detail: slot });
  } else if (row.approval_kind === "screening_review") {
    // Accepting an AI screening flows the candidate into interview scheduling:
    // advance a stage AND queue them on the calendar (Schedule tab) with a
    // default proposed slot, so the interviewer can pick a time + open the prep.
    const idx = PIPELINE_STAGES.indexOf(row.stage as PipelineStage);
    const next = PIPELINE_STAGES[Math.min(idx + 1, PIPELINE_STAGES.length - 1)];
    db.prepare(
      `UPDATE pipeline_entries SET stage=?, approval_kind='calendar', approval_detail=?, stage_changed_at=?, updated_at=? WHERE id=?`
    ).run(next, "Tue 14:00", now, now, id);
    recordEvent(db, { ...meta, kind: "advanced", toStage: next, detail: decisionNote });
  } else {
    // accept: advance one stage, clear any pending approval
    const idx = PIPELINE_STAGES.indexOf(row.stage as PipelineStage);
    const next = PIPELINE_STAGES[Math.min(idx + 1, PIPELINE_STAGES.length - 1)];
    if (next !== row.stage) {
      db.prepare(
        `UPDATE pipeline_entries SET stage=?, approval_kind=NULL, approval_detail='', stage_changed_at=?, updated_at=? WHERE id=?`
      ).run(next, now, now, id);
      recordEvent(db, { ...meta, kind: "advanced", toStage: next, detail: decisionNote });
    } else {
      // Already at the terminal stage (Hired): clear the approval but don't bump
      // stage_changed_at — that timestamp anchors time-to-hire and must not move.
      db.prepare(
        `UPDATE pipeline_entries SET approval_kind=NULL, approval_detail='', updated_at=? WHERE id=?`
      ).run(now, id);
    }
  }
  const updated = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ?`).get(id) as PipelineRow;
  return rowToEntry(updated);
  });
  // IMMEDIATE: take the write lock at BEGIN (not at first write), so the SELECT
  // above can never read a row another connection is about to change under us.
  const result = tx.immediate();
  // W5-2 (DEVO2) — a rejected "ds-" (promoted-submission) entry auto-feeds the
  // dev-case calibration loop with the ground truth the control room asked a
  // human to re-type. AFTER the transaction (dev_outcomes lives on its own
  // connection) and best-effort: calibration must never fail a reject.
  if (action === "reject" && result && result.status === "rejected") {
    try {
      if (recordPipelineOutcome(result, "rejected")) {
        recordAudit({
          actor: "system",
          action: "outcome_auto_recorded",
          reason: `${result.candidateLabel}: rejected (predicted ${result.matchScore ?? "—"})`,
        });
      }
    } catch (error) {
      console.error("[pipeline:act] outcome auto-record failed", error);
    }
    // W6-4 (VOX1) — a rejected candidate must not keep a live AI-interview
    // credential in their inbox. Best-effort; /connect's terminal-entry guard
    // is the backstop for paths that don't run through here (e.g. decline).
    try {
      revokeOpenInterviewSessions(result.id);
    } catch (error) {
      console.error("[pipeline:act] interview-link revoke failed", error);
    }
  }
  return result;
}

/** Manually set a pipeline entry's stage — the recruiter override the AI-driven
 *  accept/reject can't express: move BACKWARD (Interview → Screened after a
 *  no-show), skip a stage, or fix a miscategorized entry. Same IMMEDIATE-tx +
 *  optional expectedStage CAS as actOnPipelineEntry, so a hand move can't clobber
 *  (or be clobbered by) a concurrent automated write. Clears any pending approval
 *  (the context it was drafted for is gone) and stamps stage_changed_at on a real
 *  move so time-in-stage stays honest; a no-op (toStage === current) returns the
 *  entry unchanged. Records a `moved` event so the override is auditable in the
 *  activity feed and the candidate's history. Returns null on a missing row, a CAS
 *  miss, a terminal entry (a closed-out candidate isn't reopened by a stage nudge),
 *  or an unknown toStage. */
export function setPipelineEntryStage(
  id: string,
  toStage: string,
  opts?: { expectedStage?: string }
): PipelineEntry | null {
  if (!(PIPELINE_STAGES as readonly string[]).includes(toStage)) return null;
  const db = ensureDb();
  const tx = db.transaction((): PipelineEntry | null => {
    const row = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ?`).get(id) as PipelineRow | undefined;
    if (!row) return null;
    if (opts?.expectedStage !== undefined && row.stage !== opts.expectedStage) {
      console.warn(
        `[pipeline:set_stage] skipped stale move for entry ${id}: expected '${opts.expectedStage}', row is now '${row.stage}'.`
      );
      return null;
    }
    // A rejected / declined / rematched entry is terminal — moving its stage would
    // imply a reopen this surface doesn't model (status, not stage, closes a
    // candidate). The board only lists active entries, so this is belt-and-braces.
    if (isTerminalEntryStatus(row.status)) return null;
    if (row.stage === toStage) return rowToEntry(row); // no-op: already there
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE pipeline_entries SET stage=?, approval_kind=NULL, approval_detail='', stage_changed_at=?, updated_at=? WHERE id=?`
    ).run(toStage, now, now, id);
    recordEvent(db, {
      entryId: id,
      candidateLabel: row.candidate_label,
      jobTitle: row.job_title,
      archetype: row.archetype,
      fromStage: row.stage,
      kind: "moved",
      toStage,
      detail: "manual",
    });
    const updated = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ?`).get(id) as PipelineRow;
    return rowToEntry(updated);
  });
  return tx.immediate();
}

// What `rematchSourceEntry` did to the source entry, so the caller can label the
// AutomationResult and tests can pin each branch. `closed` is true ONLY when this
// call flipped a live source to the terminal `rematched` status.
export type RematchSourceResult = {
  closed: boolean;
  outcome: "closed" | "already_terminal" | "hired" | "missing";
};

/** Resolve the SOURCE entry of a rematch (idea-9ad8a777). Rematch REDIRECTS a
 *  candidate to a better-fit open role by opening a TARGET entry for another job;
 *  this closes out the source so the same person is never live + automatable in two
 *  funnels at once (which would let the policy pass advance / reject / email them
 *  twice and double-count them in the active funnel).
 *
 *  Atomic + CAS-guarded: the rematch decision came from a seconds-long LLM/Python
 *  hop, so the source may have moved or closed meanwhile — we re-read it inside the
 *  tx and branch on its CURRENT state, never the stale snapshot:
 *    - active & not Hired → close to the dedicated terminal `rematched` status
 *      (distinct from a company `reject` / candidate `decline` so the funnel counts
 *      stay honest), clearing any pending approval. closed=true.
 *    - already terminal (rejected / declined) → the documented rejected/idle
 *      re-engagement case: leave the status, just stamp the link. closed=false.
 *    - Hired (placed; status stays 'active', stage 'Hired') → never redirected,
 *      and crucially never linked, so a placed candidate can't be pulled into a
 *      second funnel. closed=false. (runAutomationTask also guards Hired up front.)
 *    - missing → no-op.
 *  In every reachable non-Hired case the `rematched` source→target link event is
 *  recorded, so the redirect is traceable from the source side (Activity log,
 *  candidateOutcomes). The symmetric `rematched_from` back-link on the target is
 *  recorded by the caller, which owns the target row. */
export function rematchSourceEntry(
  sourceId: string,
  targetEntryId: string,
  targetJobId: string
): RematchSourceResult {
  const db = ensureDb();
  const hiredStage = PIPELINE_STAGES[PIPELINE_STAGES.length - 1]; // terminal STAGE ("Hired")
  const tx = db.transaction((): RematchSourceResult => {
    const row = db.prepare(`SELECT * FROM pipeline_entries WHERE id = ?`).get(sourceId) as PipelineRow | undefined;
    if (!row) return { closed: false, outcome: "missing" };
    // A placed candidate (Hired keeps status='active') is never redirected — and
    // is left entirely untouched so no rematch link attaches to a hire.
    if (row.status === "active" && row.stage === hiredStage) return { closed: false, outcome: "hired" };
    const meta = {
      entryId: sourceId,
      candidateLabel: row.candidate_label,
      jobTitle: row.job_title,
      archetype: row.archetype,
    };
    // Stamp the concrete source→target link (job ids + target entry id) regardless
    // of whether we also flip the status, so the redirect is always auditable.
    const linkDetail = `${row.job_id ?? "?"} -> ${targetJobId} (${targetEntryId})`;
    if (isTerminalEntryStatus(row.status)) {
      recordEvent(db, { ...meta, kind: "rematched", toStage: row.stage, detail: linkDetail });
      return { closed: false, outcome: "already_terminal" };
    }
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE pipeline_entries SET status='rematched', approval_kind=NULL, approval_detail='', updated_at=? WHERE id=?`
    ).run(now, sourceId);
    recordEvent(db, { ...meta, kind: "rematched", toStage: row.stage, detail: linkDetail });
    return { closed: true, outcome: "closed" };
  });
  // IMMEDIATE: lock at BEGIN so the re-read can't race a concurrent move/close.
  return tx.immediate();
}
