import path from "node:path";
import { readFileSync, existsSync } from "node:fs";
import Database from "better-sqlite3";
import type { ApprovalKind } from "../approval-kinds";
import { openStore } from "../db-path";
import type { GithubEvidenceSummary } from "../github-summary";
import type { PipelineStage } from "../pipeline-stages";

// Memoized on globalThis (not just module scope): Next dev HMR re-evaluates this
// module with a fresh module-local binding, which would re-run the ENTIRE
// CREATE/ALTER/seed/backfill initializer below against a kp.sqlite file the
// surviving connections are mid-writing (duplicate seeding + migration races, with
// the ALTER loop's bare catch{} swallowing real failures). Caching the connection
// on globalThis makes ensureDb() initialize exactly once per process across reloads.
const _dbHolder = globalThis as typeof globalThis & { __kpDb?: Database.Database };

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
export function safeRowParse<T>(json: string | null | undefined, ctx: string, id?: string): T | null {
  if (json == null) return null;
  try {
    return JSON.parse(json) as T;
  } catch (error) {
    console.error(`[db:${ctx}] corrupt JSON for row ${id ?? "?"} — ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export function ensureDb(): Database.Database {
  if (_dbHolder.__kpDb) return _dbHolder.__kpDb;
  // Canonical isolated-store open (WAL + busy_timeout=5000): the scheduler writes
  // scheduler/scheduler_runs on its own connection to the same kp.sqlite file
  // while the policy pass writes pipeline_entries/events here — the busy_timeout
  // makes a concurrent writer wait briefly rather than instantly throwing
  // SQLITE_BUSY.
  const db = openStore();
  db.exec(`
    -- Tenant root (P2): one row per workspace. A single default workspace today
    -- (id 'workspace', matching billing's id) — the seam multi-tenancy fills.
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT,
      created_at TEXT NOT NULL
    );

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

    -- JD edit history (idea-6a18e0fc): a snapshot of the PRE-edit (title, body)
    -- written on each updateJd, so an edit is diff-able and revertable. The
    -- destructive in-place PATCH used to make a typo unrecoverable.
    CREATE TABLE IF NOT EXISTS jd_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_jd_revisions_slug
      ON jd_revisions (slug, id DESC);

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

    -- E3 (Erika gap) — inbound channel webhooks: one unguessable public token
    -- per (channel, job) binding. The receiver at /api/channels/inbound/[token]
    -- maps external lead payloads (ad forms, board integrations) into the same
    -- lead intake as the quick-apply form. A revoked row keeps its history but
    -- stops receiving (the receiver checks revoked_at).
    CREATE TABLE IF NOT EXISTS channel_webhooks (
      token TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      job_id TEXT NOT NULL,
      lang TEXT,
      created_at TEXT NOT NULL,
      revoked_at TEXT,
      received_count INTEGER NOT NULL DEFAULT 0,
      last_received_at TEXT,
      first_received_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_channel_webhooks_channel ON channel_webhooks (channel);

    -- E5 (Erika gap) — recruiter-entered spend per inbound source channel (CZK),
    -- the denominator for cost-per-applicant / cost-per-hire in analytics. One
    -- row per channel id; deleting the row clears the figure.
    CREATE TABLE IF NOT EXISTS channel_spend (
      channel TEXT PRIMARY KEY,
      amount_czk REAL NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- 82c2b8e8 — recruiter-set analytics goals: one row per metric. The metric
    -- key is a funnel stage name (conversion %% target for that stage) or the
    -- reserved 'time_to_hire' (target in days). Goal lines on the funnel + the
    -- goal-aware miss flagging read from here; deleting the row clears the goal.
    CREATE TABLE IF NOT EXISTS analytics_targets (
      metric TEXT PRIMARY KEY,
      target_value REAL NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- E1 (Erika gap) — sourcing campaign packs, one per (job, language).
    -- Durable recruiter artifacts, deliberately NOT the prompt cache: a pack
    -- must survive restarts and TTLs, and "Regenerate" must produce a fresh
    -- pack rather than replay a cached one. POST /api/jobs/[id]/campaign upserts.
    CREATE TABLE IF NOT EXISTS campaign_packs (
      job_id TEXT NOT NULL,
      lang TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (job_id, lang)
    );

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

    -- Live Work Surface (moonshot E): an in-product dev-case work session and its
    -- append-only observed process-event log. files_json holds the candidate's
    -- (editable) seed tree; submission_id links to the dev_submissions row created
    -- on submit (repo_ref = "session:<id>") so the eval can load the observed events.
    CREATE TABLE IF NOT EXISTS dev_sessions (
      id TEXT PRIMARY KEY,
      token TEXT,
      candidate_ref TEXT,
      files_json TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      submission_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      submitted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS dev_session_events (
      session_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      t INTEGER,
      kind TEXT NOT NULL,
      path TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (session_id, seq)
    );

    -- Durable Skill Profile (moonshot A): a signed, candidate-owned credential
    -- minted from an evaluated dev-case submission. profile_json is the exact
    -- signed artifact; signature is HMAC(KP_SECRET) over its canonical form.
    CREATE TABLE IF NOT EXISTS skill_profiles (
      token TEXT PRIMARY KEY,
      submission_id TEXT,
      candidate_ref TEXT,
      case_id TEXT,
      profile_json TEXT NOT NULL,
      signature TEXT NOT NULL,
      version TEXT NOT NULL,
      issued_at TEXT NOT NULL,
      revoked_at TEXT
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
    CREATE INDEX IF NOT EXISTS idx_skill_profiles_submission ON skill_profiles (submission_id);

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
      lang TEXT,
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

    -- Multi-provider LLM layer (docs/LLM_PROVIDER_LAYER.md). llm_config pins
    -- provider+model per use case (explicit rows only — absence means the
    -- built-in default, i.e. Claude CLI locally); provider_keys holds
    -- UI-entered keys encrypted with KP_SECRET (env keys keep working without
    -- a row).
    CREATE TABLE IF NOT EXISTS llm_config (
      use_case TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      model TEXT,
      params_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS provider_keys (
      provider TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'byom',
      key_ciphertext TEXT NOT NULL,
      meta_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (provider, scope)
    );

    -- LLM metering ledger (T0.1): one row per metered LLM envelope, the durable
    -- spend/usage record the pricing meters and the Models usage panel read.
    -- Restored after the 2026-06-14 refactor deleted it as an unwired stub; it is
    -- now WIRED — Python's monitor.emit_result writes a sidecar NDJSON line per
    -- call and spawnPython ingests it here (see db/llm.ts ingestLlmUsageLog).
    -- model is nullable (the Claude CLI default reports no pinned model);
    -- source is 'llm' (only real LLM calls reach the monitor seam).
    CREATE TABLE IF NOT EXISTS llm_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      use_case TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cached_tokens INTEGER,
      cost_usd REAL,
      source TEXT NOT NULL,
      request_id TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_llm_usage_ts ON llm_usage (ts);
    CREATE INDEX IF NOT EXISTS idx_llm_usage_use_case ON llm_usage (use_case, provider);

    -- Payment gate (docs/BILLING.md). Single-workspace model mirrors the rest
    -- of the app: billing_state is a one-row subscription snapshot synced from
    -- provider webhooks (never trusted from the client); billing_events is the
    -- webhook idempotency gate + audit; billing_credits is the prepaid ledger
    -- (minute packs — provider_ref dedupes a redelivered order); billing_usage
    -- holds per-month meter counters the entitlement checks read.
    CREATE TABLE IF NOT EXISTS billing_state (
      id TEXT PRIMARY KEY DEFAULT 'workspace',
      plan TEXT NOT NULL DEFAULT 'free',
      status TEXT NOT NULL DEFAULT 'none',
      provider TEXT,
      provider_customer_id TEXT,
      provider_subscription_id TEXT,
      current_period_start TEXT,
      current_period_end TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS billing_events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      received_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS billing_credits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meter TEXT NOT NULL,
      delta INTEGER NOT NULL,
      reason TEXT NOT NULL,
      provider_ref TEXT UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS billing_usage (
      meter TEXT NOT NULL,
      period TEXT NOT NULL,
      qty INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (meter, period)
    );

    CREATE INDEX IF NOT EXISTS idx_billing_credits_meter ON billing_credits (meter);
  `);
  // Run a DDL migration, swallowing ONLY the benign "already applied" error (re-running
  // ADD COLUMN / CREATE on a DB that already has the column). Any OTHER failure —
  // corruption, I/O, lock contention under the documented multi-connection scheduler
  // load — must NOT silently boot a structurally-broken DB: a bare `catch {}` here was
  // the exact "why is everything empty" hunt the seed-health code exists to prevent,
  // reintroduced one layer down. Surface the unexpected ones loudly and re-throw.
  const migrateExec = (sql: string) => {
    try {
      db.exec(sql);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (/duplicate column name/i.test(msg) || /already exists/i.test(msg)) return;
      console.error(`[db:migrate] unexpected failure running: ${sql}\n  ${msg}`);
      throw error;
    }
  };
  // Migration for DBs created before the observability columns existed.
  for (const col of ["created_at", "stage_changed_at"]) {
    migrateExec(`ALTER TABLE pipeline_entries ADD COLUMN ${col} TEXT`);
  }
  // Migration for DBs created before the intake-degradation flag existed. The
  // boolean column is NOT NULL DEFAULT 0 so legacy rows read as "not degraded".
  for (const sql of [
    "ALTER TABLE pipeline_entries ADD COLUMN intake_degraded INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE pipeline_entries ADD COLUMN intake_degraded_reason TEXT",
    // Candidate contact captured at inbound apply (idea APP2) — makes the comms
    // stack deliverable for applicants instead of dead-lettering to "candidate".
    "ALTER TABLE pipeline_entries ADD COLUMN contact TEXT",
    // Applicant's locale captured at inbound apply (SIM3) — so every downstream
    // candidate-facing comm renders in the language they applied in, not
    // English. NULL on recruiter/Match-sourced rows ⇒ default "en" at dispatch.
    "ALTER TABLE pipeline_entries ADD COLUMN locale TEXT",
    // Compact GitHub evidence summary captured at add-to-pipeline (GH2):
    // coerceGithubEvidenceSummary-shaped JSON, bounded at write AND read.
    "ALTER TABLE pipeline_entries ADD COLUMN github_json TEXT",
    // Self-reported GitHub handle captured at inbound apply (normalized bare
    // username — see coerceGithubHandle in apply-intake.ts), the hook the
    // drawer's on-demand deep-dive runs from. NULL when the applicant skipped
    // the step (and on recruiter/Match adds, which attach full evidence instead).
    "ALTER TABLE pipeline_entries ADD COLUMN github_handle TEXT",
    // E3 (Erika gap) — fine-grained inbound source attribution, the queryable
    // axis funnel economics (E5) will group on: 'apply' (conversational),
    // 'quick-apply', or a webhook channel id ('email'/'boards'). NULL on
    // recruiter/Match-sourced and legacy rows — "no inbound channel recorded".
    "ALTER TABLE pipeline_entries ADD COLUMN source_channel TEXT",
    // E5 — campaign/creative attribution: utm_campaign/utm_content-style values
    // captured at intake (webhook payload fields, quick-apply ?c=/&v= params).
    // Powers the per-variant performance table + pause recommendations.
    "ALTER TABLE pipeline_entries ADD COLUMN source_campaign TEXT",
    "ALTER TABLE pipeline_entries ADD COLUMN source_variant TEXT",
    // Lead enrichment hand-off — an opaque CSPRNG capability token minted on a
    // lead entry (ensureLeadEnrichToken) and carried by the ack's "complete your
    // profile" link, so the conversational apply opens knowing WHO is enriching
    // and the merge targets this exact entry. NEVER the raw entry id: entry ids
    // are internal IDOR handles (same doctrine as the schedule/offer tokens).
    "ALTER TABLE pipeline_entries ADD COLUMN lead_token TEXT",
    // The KO step ids the lead EXPLICITLY answered true at intake (JSON array),
    // so the enrichment chat can skip exactly those gates — recorded pass-state,
    // never derived. NULL = nothing verified (the chat asks every gate).
    "ALTER TABLE pipeline_entries ADD COLUMN lead_passed_ko_json TEXT",
    // Persistent per-candidate recruiter note: call facts ("wants 80k, available
    // August, hybrid") autosaved from the drawer's always-visible scratchpad, so
    // they survive closing it instead of living in spreadsheets. Free text,
    // trimmed and length-bounded at the route (set_notes); NULL = no note.
    "ALTER TABLE pipeline_entries ADD COLUMN notes TEXT",
    // GDPR data-processing consent lifecycle (consent.ts). given_at = when the
    // candidate agreed at apply; expires_at = given_at + CONSENT_TTL_DAYS (the
    // anonymization sweep reads it); source = apply|quick-apply|recruiter|webhook
    // id; anonymized_at stamped when the row was scrubbed-but-retained (PII gone,
    // scores/notes/stage kept for re-engagement). All NULL on legacy/recruiter rows.
    "ALTER TABLE pipeline_entries ADD COLUMN consent_given_at TEXT",
    "ALTER TABLE pipeline_entries ADD COLUMN consent_expires_at TEXT",
    "ALTER TABLE pipeline_entries ADD COLUMN consent_source TEXT",
    "ALTER TABLE pipeline_entries ADD COLUMN anonymized_at TEXT",
    // Self-service erasure capability token (right to erasure): minted on demand
    // (ensureErasureToken), carried by the "manage your data" footer in every
    // candidate email and resolved at the public /data/[token] page. Opaque CSPRNG
    // like lead_token — NEVER the raw entry id.
    "ALTER TABLE pipeline_entries ADD COLUMN erasure_token TEXT",
    // E5 — when a webhook received its FIRST lead (time-to-first-lead metric).
    // Tenant scope (P2) for the BOARD: pipeline_entries had NO workspace column (only
    // analyses/profiles did), so the analysis→board chip + disposition echo matched
    // candidates by label ACROSS tenants. DEFAULT 'workspace' backfills existing rows
    // and keeps every insert single-tenant-correct until createPipelineEntry stamps the
    // real session workspace (so a future multi-tenant enable scopes immediately).
    "ALTER TABLE pipeline_entries ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'workspace'",
    "ALTER TABLE channel_webhooks ADD COLUMN first_received_at TEXT",
    // E5 metric honesty: `received_count`/`first_received_at` stamp EVERY POST (probes,
    // health-checks, malformed integrations), so they overstate real leads. Track
    // ACCEPTED leads separately — incremented only when intake actually files a lead —
    // so "leads received" and time-to-first-lead reflect candidates, not pings.
    "ALTER TABLE channel_webhooks ADD COLUMN accepted_count INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE channel_webhooks ADD COLUMN first_accepted_at TEXT",
  ]) {
    migrateExec(sql);
  }
  // The lead-token lookup runs once per tokened apply-page view and once per
  // tokened apply POST — index it like the interview token. Created AFTER the
  // ALTER loop above so a legacy DB already holds the column.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_pipeline_lead_token ON pipeline_entries (lead_token)`);
  // Tenant scope: the board chip / disposition echo filter pipeline_entries by workspace.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_pipeline_workspace ON pipeline_entries (workspace_id)`);
  // Same single-row public lookup for the self-service erasure token.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_pipeline_erasure_token ON pipeline_entries (erasure_token)`);
  // The anonymization sweep scans for due consents — index the expiry so it stays
  // a range probe rather than a full table scan as the board grows.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_pipeline_consent_expiry ON pipeline_entries (consent_expires_at)`);
  // GDPR consent audit trail (append-only): one row per transition so a tenant can
  // evidence WHEN consent was granted/renewed/expired and WHEN PII was scrubbed or
  // erased. kind ∈ granted|renewed|expiring_notified|expired|anonymized|
  // erasure_requested|erased. Idempotent CREATE (no migration), like jd_revisions.
  db.exec(`
    CREATE TABLE IF NOT EXISTS consent_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_consent_events_entry ON consent_events (entry_id, id DESC);
  `);
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
    // Tenant scope (P2): the workspace a saved analysis belongs to. NULL on legacy
    // rows ⇒ backfilled to the default workspace below. The first scoped table.
    "ALTER TABLE analyses ADD COLUMN workspace_id TEXT",
    // Tenant scope (P2): the profiles domain (2nd scoped table). Same backfill below.
    "ALTER TABLE profiles ADD COLUMN workspace_id TEXT",
    // JD archive (W8-4/JDL1): archived JDs drop out of listJds and the pickers,
    // but loadJd keeps serving them so existing analysis links never 404.
    "ALTER TABLE jds ADD COLUMN archived_at TEXT",
    // DEVP5 — the candidate-facing language for this role's case artifacts
    // (brief/tasks, seed README+DECISIONS, interview narration), captured at
    // need intake. NULL ⇒ "en" when threaded to the dev-case CLIs.
    "ALTER TABLE dev_lifecycle ADD COLUMN lang TEXT",
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
  // Tenant foundation (P2): ensure the single default workspace row exists ('workspace'
  // matches DEFAULT_WORKSPACE in auth/session.ts and billing's id).
  db.prepare(`INSERT OR IGNORE INTO workspaces (id, name, created_at) VALUES (?, ?, ?)`).run("workspace", "Default workspace", new Date().toISOString());
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_analyses_workspace ON analyses (workspace_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_profiles_workspace ON profiles (workspace_id)`);
  } catch {
    /* index already exists */
  }
  seedExampleJd(db);
  seedJobs(db);
  seedCandidates(db);
  seedAnalyses(db);
  seedPipeline(db);
  migratePipelineStages(db); // remap any legacy 7-stage rows to the 5-stage model
  backfillDeclinedStatus(db); // split candidate declines out of overloaded `rejected`
  // Tenant scope (P2): backfill ANY analyses row missing a workspace_id (legacy
  // rows AND freshly-seeded ones) to the default workspace. After all seeders so
  // it's order-independent — a seeded row that didn't stamp the column is caught.
  db.prepare(`UPDATE analyses SET workspace_id = ? WHERE workspace_id IS NULL`).run("workspace");
  db.prepare(`UPDATE profiles SET workspace_id = ? WHERE workspace_id IS NULL`).run("workspace");
  // Null-contract heal: `approval_detail` is nullable and "no detail" is NULL (its
  // sibling approval_kind clears to NULL), but earlier clear/insert paths wrote '',
  // so a "cleared" detail read back as "" on some rows and NULL on others. Now that
  // every writer uses NULL, fold the legacy empty strings to NULL so consumers see
  // one canonical "no detail". Idempotent (a no-op once healed; new rows never write '').
  db.prepare(`UPDATE pipeline_entries SET approval_detail = NULL WHERE approval_detail = ''`).run();
  _dbHolder.__kpDb = db;
  // Reclaim expired (and, once their TTL lapses, superseded-PROMPT_VERSION)
  // cache rows on boot. lookupPromptCache only SKIPS expired rows — it never
  // deletes them — so without this the prompt cache table and its WAL grow
  // unbounded for the life of the deployment. __kpDb is assigned first so the
  // ensureDb() inside prunePromptCache() short-circuits instead of re-entering
  // this initializer. A prune failure must never wedge boot.
  try {
    const pruned = prunePromptCache();
    if (pruned > 0) console.log(`[db] pruned ${pruned} expired prompt-cache row(s) on boot`);
  } catch (error) {
    console.error("[db] prompt-cache boot prune failed", error);
  }
  // Checkpoint + TRUNCATE the WAL on boot. Under synchronous=NORMAL the -wal/-shm
  // sidecars accumulate committed pages until a checkpoint folds them back into the
  // main db file; nothing forced one, so they grew unbounded for the life of the
  // deployment. TRUNCATE both checkpoints AND shrinks the -wal back to zero. Every
  // store opens the same kp.sqlite file, so this one call bounds the shared WAL.
  // Best-effort — a checkpoint failure (e.g. a concurrent reader holding it open)
  // must never wedge boot.
  try {
    db.pragma("wal_checkpoint(TRUNCATE)");
  } catch (error) {
    console.error("[db] boot WAL checkpoint failed", error);
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
export function insertWithUniqueSlug(insert: (slug: string) => void): string {
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
  // Provenance from normalize_job: fields filled with an assumed value (locale
  // defaults, or the "salary_band" market-anchor band) rather than stated by the
  // ad. Older payloads predate the field, hence optional.
  defaultedFields?: string[];
  source?: string;
  // Lifecycle decorated from the jobs.status COLUMN (not payload_json — the
  // column is the authority setJobStatus writes). NULL = seeded/live corpus job;
  // 'draft' is not publicly live, 'closed' no longer accepts applications
  // (isJobOpenForApplications in job-ingest.ts is the one open-for-apply gate).
  status?: "draft" | "published" | "closed" | null;
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
  // Applicant's locale captured at inbound apply (SIM3), else null. Drives the
  // language of every downstream candidate-facing comm; null ⇒ "en" at dispatch.
  locale: string | null;
  // Compact GitHub evidence summary captured at add-to-pipeline (GH2), else
  // null. Bounded by coerceGithubEvidenceSummary on both write and read.
  githubEvidence: GithubEvidenceSummary | null;
  // Self-reported GitHub handle captured at inbound apply (normalized bare
  // username), else null. Lets the drawer offer the on-demand deep-dive when
  // no evidence has been attached yet.
  githubHandle: string | null;
  // E3 — inbound source attribution: 'apply' (conversational), 'quick-apply',
  // or a webhook channel id ('email'/'boards'). NULL = recruiter/Match-sourced
  // or predates attribution. The axis E5 funnel economics groups on.
  sourceChannel: string | null;
  // E5 — campaign/creative attribution (utm_campaign / utm_content-style),
  // captured at intake. NULL when the source carried none.
  sourceCampaign: string | null;
  sourceVariant: string | null;
  // Persistent per-candidate recruiter note, autosaved from the drawer via the
  // set_notes action (trimmed + bounded there). NULL when none has been written.
  notes: string | null;
  // GDPR data-processing consent lifecycle (consent.ts) — recruiter-visible so the
  // drawer can show status/expiry. The erasure capability token is deliberately
  // NOT surfaced here (read server-side from the row), same doctrine as lead_token.
  consentGivenAt: string | null;
  consentExpiresAt: string | null;
  consentSource: string | null;
  anonymizedAt: string | null;
};

export function recordEvent(
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
