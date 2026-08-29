import path from "node:path";
import { readFileSync, existsSync } from "node:fs";
import Database from "better-sqlite3";
import type { ApprovalKind } from "../approval-kinds";
import { openStore } from "../db-path";
import type { GithubEvidenceSummary } from "../github-summary";
import { jdJobId } from "../jd-limits";
import type { PipelineStage } from "../pipeline-stages";
import { assertTenancyReady } from "../tenancy";
import { multiWorkspaceEnabled } from "../workspace-lock";
import { seedBenchmarkTeam } from "./seed-benchmark-team";
import { adoptedExistingSeed, markSeedRan, seedAlreadyRan } from "./seed-marks";
import { fixtureSeedEnabled } from "./seed-gate";

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

/** A zod-shaped validator, structurally typed so this module never imports zod (or
 *  the generated schemas, which would invert the dependency direction the data layer
 *  is supposed to hold). Any `z.ZodType` satisfies it. */
export type RowValidator<T> = {
  safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: unknown };
};

/** What a JSON column actually was. `absent` (NULL/missing) and `unreadable` are
 *  DIFFERENT FACTS and deliberately do not share an answer: a by-identity read that
 *  reports a corrupt row as "not found" invites its caller to recreate the record,
 *  and then the identity exists twice and the corruption has bred. */
export type RowColumn<T> =
  | { state: "absent" }
  | { state: "ok"; value: T }
  | { state: "unreadable"; reason: "corrupt" | "invalid"; detail: string };

export type RowIssue = { ctx: string; id: string; reason: "corrupt" | "invalid"; detail: string; at: string };

/** `enforce` — a shape mismatch makes the column unreadable (the end state).
 *  `observe` — the mismatch is recorded and the value is still returned, for adopting
 *  validation over a table that already holds nonconforming rows. */
export type ValidationMode = "enforce" | "observe";

const ROW_ISSUE_SAMPLE = 50;
const rowIssues: RowIssue[] = [];
let rowIssueTotal = 0;

/** Read-side accounting for the decode seam. Every row passes here, so this is the
 *  one layer that can answer "how healthy is the stored data" — and it is unobtainable
 *  anywhere else, because no other layer sees every row. Sibling of getSeedHealth().
 *  `total` counts every unreadable column since boot; `issues` retains the most recent
 *  sample so a flood cannot evict the count itself. */
export function getRowHealth(): { ok: boolean; total: number; issues: RowIssue[] } {
  return { ok: rowIssueTotal === 0, total: rowIssueTotal, issues: [...rowIssues] };
}

/** Test seam — resets the ledger between cases. Not for production paths. */
export function __resetRowHealth(): void {
  rowIssues.length = 0;
  rowIssueTotal = 0;
}

function recordRowIssue(ctx: string, id: string, reason: "corrupt" | "invalid", detail: string): void {
  rowIssueTotal += 1;
  rowIssues.push({ ctx, id, reason, detail, at: new Date().toISOString() });
  if (rowIssues.length > ROW_ISSUE_SAMPLE) rowIssues.shift();
  console.error(`[db:${ctx}] ${reason} JSON for row ${id} — ${detail}`);
}

/**
 * The decode seam: an untyped JSON column becomes a typed domain value here or
 * nowhere. Two failure modes, both recorded, neither silent:
 *
 *  - `corrupt`  — the text is not JSON (a crashed write, a hand edit).
 *  - `invalid`  — the text parses but does not match the declared shape. Only
 *                 checked when a validator is passed. This is the drift class
 *                 `schemas:gen` exists to prevent: the Python model renames a field,
 *                 codegen faithfully regenerates the zod schema, `tsc` still passes
 *                 because the DB layer only ever used the TYPE — and the mismatch
 *                 surfaces as `undefined` on a candidate-facing page.
 *
 * The seam takes no side on what a failure MEANS: it reports, records, and returns.
 * The collection site — which knows its consumer — picks fail-whole or degrade-visibly.
 * What no consumer justifies is skipping silently, which turns corruption into data
 * that "never existed"; recording before returning is what makes that unavailable.
 */
export function readRowColumn<T>(
  json: string | null | undefined,
  ctx: string,
  id?: string,
  validator?: RowValidator<T>,
  mode: ValidationMode = "enforce"
): RowColumn<T> {
  if (json == null) return { state: "absent" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    recordRowIssue(ctx, id ?? "?", "corrupt", detail);
    return { state: "unreadable", reason: "corrupt", detail };
  }
  if (!validator) return { state: "ok", value: parsed as T };
  const result = validator.safeParse(parsed);
  if (result.success) return { state: "ok", value: result.data };
  const detail = summarizeValidationError(result.error);
  recordRowIssue(ctx, id ?? "?", "invalid", detail);
  // OBSERVE: the shape is wrong and now counted, but the value is still handed on.
  // The posture for switching validation on over a table that already holds
  // nonconforming rows — enforcing immediately would turn a pre-existing data defect
  // into a 41%-of-the-list outage, which is the failure the degrade-visibly policy
  // exists to avoid. It is NOT the banned silent skip: the issue is recorded before
  // it returns, so the drift is visible in getRowHealth() from the first read.
  // Graduate a column to "enforce" once its ledger is clean.
  if (mode === "observe") return { state: "ok", value: parsed as T };
  return { state: "unreadable", reason: "invalid", detail };
}

/** Zod's error shape without importing zod: `issues[]` with `path` + `message`. */
function summarizeValidationError(error: unknown): string {
  const issues = (error as { issues?: { path?: unknown[]; message?: string }[] } | null)?.issues;
  if (!Array.isArray(issues) || issues.length === 0) return "shape mismatch";
  return issues
    .slice(0, 3)
    .map((i) => `${Array.isArray(i.path) && i.path.length ? i.path.join(".") : "(root)"}: ${i.message ?? "invalid"}`)
    .join("; ");
}

/**
 * Back-compat wrapper over readRowColumn: collapses `absent` and `unreadable` to null
 * for the ~76 call sites that only need "a value or nothing". Unchanged in behaviour —
 * a corrupt row still logs and still degrades the caller to N-1 — but it now also
 * records to the row-health ledger, so the skip is countable rather than only visible
 * to whoever is reading stderr.
 *
 * Prefer readRowColumn directly when the caller is a BY-IDENTITY read: there, "absent"
 * and "unreadable" are different answers and collapsing them is the bug this seam was
 * split to expose.
 */
export function safeRowParse<T>(
  json: string | null | undefined,
  ctx: string,
  id?: string,
  validator?: RowValidator<T>,
  mode: ValidationMode = "enforce"
): T | null {
  const column = readRowColumn<T>(json, ctx, id, validator, mode);
  return column.state === "ok" ? column.value : null;
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

    -- ── Identity foundation (P0 — Organization / Teams / Users) ──────────────
    -- The ORGANIZATION is the top tenant boundary (the customer company). It owns
    -- the subscription + the cross-team reference pool; every workspace (a TEAM)
    -- belongs to one org via workspaces.org_id (added by migration below). These
    -- identity tables are scoped by org_id, NOT by the per-team workspace_id the
    -- tenancy manifest governs — so they carry no workspace_id and are listed
    -- EXEMPT there (their cross-org isolation is enforced in their own stores).
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      domain TEXT,
      default_locale TEXT NOT NULL DEFAULT 'cs',
      created_at TEXT NOT NULL
    );

    -- A person in an org. Identity ONLY — the secret lives in user_credentials so
    -- the model stays auth-mechanism-agnostic (a future SSO/OIDC seam adds its own
    -- credential table without touching this one). email is globally unique so
    -- login resolves email → user → org. status ∈ active | invited | disabled.
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_users_org ON users (org_id);

    -- Local password credential (scrypt), one row per user, kept OUT of the users
    -- table. Stored value is saltB64url:hashB64url (see app/_lib/auth/password.ts).
    CREATE TABLE IF NOT EXISTS user_credentials (
      user_id TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- A user's membership of ONE team (workspace) + their role there. Many-to-many
    -- (a recruiter can span several teams of the same org); UNIQUE(user_id,
    -- workspace_id) = one role per user per team. role ∈ owner | admin | recruiter
    -- | hiring_manager | viewer.
    CREATE TABLE IF NOT EXISTS memberships (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      role TEXT NOT NULL,
      -- Per-user permission overrides layered on the role defaults (P0): JSON
      -- { grant: Capability[], revoke: Capability[] }. NULL = pure role defaults.
      -- org:manage is never grantable via an override (owner-role only) so an
      -- admin can't escalate anyone to owner-level control.
      capability_overrides TEXT,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_memberships_user_ws ON memberships (user_id, workspace_id);
    CREATE INDEX IF NOT EXISTS idx_memberships_ws ON memberships (workspace_id);
    CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships (user_id);

    -- Pending invitation to join an org (and optionally a specific team). The
    -- token is the unguessable accept link (randomToken). status ∈ pending |
    -- accepted | revoked. Replaces the mocked InviteEditor.
    CREATE TABLE IF NOT EXISTS invites (
      token TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      workspace_id TEXT,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      -- RETAINED BY DESIGN on member removal (cascade posture: detach). The invite
      -- has independent meaning; a dangling user id here reads as "a removed user",
      -- and no reader dereferences it. See docs/specs/2026-08-30-member-removal-
      -- blast-radius.md — absence of a cleanup is a decision, not an omission.
      invited_by TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT,
      accepted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_invites_org ON invites (org_id);
    CREATE INDEX IF NOT EXISTS idx_invites_email ON invites (email);

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
      created_at TEXT NOT NULL,
      -- Source lineage (profile ↔ CV): when a profile was built FROM a saved CV
      -- analysis, these back-reference it so "a newer analysis of the same CV
      -- exists since this profile was built" (staleness) is detectable. All NULL
      -- on a hand-built profile (never fabricated) ⇒ no staleness, no badge.
      source_analysis_slug TEXT,
      source_cv_hash TEXT,
      source_analyzed_at TEXT,
      -- Divergence tracking (profile "rebuild that respects hand edits"): updated_at
      -- is stamped on every CONTENT write (create/edit); lineage_stamped_at on every
      -- time source lineage is (re)stamped (build-from-analysis / rebuild). A profile
      -- has DIVERGED from its analysis when updated_at > lineage_stamped_at — it was
      -- hand-edited after it was built — so a rebuild can warn before clobbering the
      -- recruiter's edits. NULL on legacy rows ⇒ divergence unprovable ⇒ no warning.
      updated_at TEXT,
      lineage_stamped_at TEXT
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
      created_at TEXT NOT NULL,
      -- UAT LUC-ANA-4 — WHO did this. The log's "Who" column could only ever render a
      -- CLASS (AUTO / HUMAN / UNKNOWN) derived from the event kind, because the row had no
      -- actor at all: five identified users sat in this same DB and not one decision
      -- named a person. Carries the decision-chain actor vocabulary ("auto:*" /
      -- "human:*"), with the natural person substituted for the role when the session
      -- carries identity ("human:Petra Nováková"). NULLABLE on purpose (guardrail G3):
      -- legacy rows, and any writer that genuinely cannot name an actor, read as "not
      -- identified" — never as a default person.
      actor TEXT
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

    -- Scheduler LIVENESS heartbeat (bug-ui-scan-2026-07-09 #1). One row, keyed by
    -- a fixed id ('clock'), holding the last time the self-rescheduling automation
    -- tick in instrumentation-node.ts fired. The ops/health surface reads it (an
    -- O(1) primary-key lookup) and judges its age via scheduler-health.schedulerLiveness,
    -- so a wedged clock reports UNHEALTHY instead of a green "Healthy" dot. Distinct
    -- from scheduler_runs (per-JOB run log): this proves the CLOCK itself is alive.
    CREATE TABLE IF NOT EXISTS scheduler_heartbeat (
      id TEXT PRIMARY KEY,
      last_tick_at TEXT NOT NULL
    );

    -- One row per one-shot fixture seeder that has run against THIS database.
    -- Deployment-global bookkeeping, the scheduler_heartbeat of seeding: it holds no
    -- tenant data, one row per seeder per install. Exists because a row COUNT cannot
    -- answer the question the seeders are actually asking. "Is the table empty" conflates
    -- "never seeded" with "seeded, and the operator has since emptied it" — so a
    -- self-hosted recruiter who archived every job got the whole ČS demo corpus injected
    -- back on the next boot, silently and on a timer. seedExampleJd already avoided this
    -- by checking for its own slug, but per-seeder identity checks only move the problem:
    -- delete the seeded rows and it still reads as "never seeded". Whether a seeder ran is
    -- a fact about the DATABASE, so record it as one.
    CREATE TABLE IF NOT EXISTS seed_marks (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

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
      -- Bug-ui-scan 2026-07-09 #1: paste MAGNITUDE (char count) for a "paste" event —
      -- the in-product bulk-paste authenticity signal (devcase-authenticity
      -- PASTE_BULK_CHARS). NULL for non-paste kinds. Legacy DBs get it via the ALTER
      -- migration below (a DB created before this column existed).
      size INTEGER,
      created_at TEXT NOT NULL,
      -- Tamper-evidence (LLM-era controls #1): server-computed SHA-256 chain link —
      -- hash(prev_hash | session | seq | event fields | server receive time). Computed
      -- at INSERT inside appendDevSessionEvents (never client-supplied), so any later
      -- edit/delete/reorder of the log breaks every downstream link and
      -- verifyDevSessionChain reports the first broken seq. NULL only on legacy rows
      -- that predate the column (verify treats a NULL-hash prefix as unverifiable).
      hash TEXT,
      PRIMARY KEY (session_id, seq)
    );

    -- LLM-era controls #2: the captured prompt channel. Every assistant / stakeholder
    -- exchange in the Live Work Surface flows through the platform and lands here —
    -- the human<->LLM dialogue is first-class evidence (prompt quality, clarifying
    -- questions) evaluated beside the artifact. role: 'user' | 'model'.
    CREATE TABLE IF NOT EXISTS dev_session_chat (
      session_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      channel TEXT NOT NULL,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      workspace_id TEXT NOT NULL DEFAULT 'workspace',
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

    -- Multi-provider LLM layer (docs/architecture/llm-provider-layer.md). llm_config pins
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
    -- source is 'llm' for real provider calls (incl. the voice-interview rows
    -- the interview complete route inserts directly with a per-minute cost
    -- estimate) or 'deterministic' when a Python CLI's template fallback served
    -- instead (monitor.emit_deterministic — zero tokens/cost).
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

    -- Payment gate (docs/features/billing/README.md). Single-workspace model mirrors the rest
    -- of the app: billing_state is a one-row subscription snapshot synced from
    -- provider webhooks (never trusted from the client); billing_events is the
    -- webhook idempotency gate + audit; billing_credits is the prepaid ledger
    -- (minute packs — provider_ref dedupes a redelivered order); billing_usage
    -- holds per-month meter counters the entitlement checks read.
    -- Org-scoped since org-plan Phase 3 (data layer): billing is per-ORG — one
    -- subscription/ledger per customer company, SHARED across its teams (the
    -- tenancy manifest's billing doctrine). org_id keys every table; the legacy
    -- single row (id 'workspace') is backfilled to 'org-default' by the
    -- migrations below, so a single-org deployment reads byte-identically.
    CREATE TABLE IF NOT EXISTS billing_state (
      id TEXT PRIMARY KEY DEFAULT 'workspace',
      org_id TEXT NOT NULL DEFAULT 'org-default',
      plan TEXT NOT NULL DEFAULT 'free',
      status TEXT NOT NULL DEFAULT 'none',
      provider TEXT,
      provider_customer_id TEXT,
      provider_subscription_id TEXT,
      current_period_start TEXT,
      current_period_end TEXT,
      updated_at TEXT NOT NULL
    );

    -- org_id here is ATTRIBUTION only — the PK stays the provider's globally
    -- unique event id, so the idempotency gate is provider-global by design.
    CREATE TABLE IF NOT EXISTS billing_events (
      id TEXT PRIMARY KEY,
      org_id TEXT,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      received_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS billing_credits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id TEXT NOT NULL DEFAULT 'org-default',
      meter TEXT NOT NULL,
      delta INTEGER NOT NULL,
      reason TEXT NOT NULL,
      provider_ref TEXT UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS billing_usage (
      org_id TEXT NOT NULL DEFAULT 'org-default',
      meter TEXT NOT NULL,
      period TEXT NOT NULL,
      qty INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (org_id, meter, period)
    );

    -- Durable "needs attention" signal for money events that can't auto-resolve
    -- (e.g. a PAID subscription for an unmapped product → the subscriber is never
    -- entitled). A queryable row so an admin surface / health check can list
    -- paid-but-dark customers instead of relying on someone watching the logs.
    CREATE TABLE IF NOT EXISTS billing_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id TEXT NOT NULL DEFAULT 'org-default',
      kind TEXT NOT NULL,
      detail TEXT NOT NULL,
      provider_ref TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_billing_credits_meter ON billing_credits (org_id, meter);
    CREATE INDEX IF NOT EXISTS idx_billing_alerts_open ON billing_alerts (resolved_at);

    -- Agent-candidate bridge (db/agents.ts): hire an AI agent for a job via the
    -- external Personas app. agent_fit_specs holds the durable job→AgentFitSpec
    -- transform artifact (append-only; latest-per-job read — the campaign_packs
    -- durable-artifact pattern, but versioned rather than upserted so an operator
    -- edit dispatches from a spec the next transform can't silently clobber).
    CREATE TABLE IF NOT EXISTS agent_fit_specs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL DEFAULT 'workspace',
      job_id TEXT NOT NULL,
      fit_json TEXT NOT NULL,
      spec_json TEXT NOT NULL,
      budget_json TEXT NOT NULL,
      metrics_json TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_agent_fit_specs_job ON agent_fit_specs (workspace_id, job_id, created_at);

    -- The hired-agent roster: one row per persona request dispatched to Personas.
    -- report_token is the CSPRNG capability the PUBLIC inbound report route
    -- authenticates by (channel_webhooks doctrine: the token IS the auth, minted
    -- by randomToken, never randomId). persona_id/name arrive later via
    -- lifecycle reports; request_id is Personas' approval id.
    CREATE TABLE IF NOT EXISTS hired_agents (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL DEFAULT 'workspace',
      job_id TEXT NOT NULL,
      job_title TEXT NOT NULL,
      persona_id TEXT,
      persona_name TEXT,
      request_id TEXT,
      status TEXT NOT NULL DEFAULT 'dispatched',
      spec_json TEXT NOT NULL,
      fit_json TEXT,
      metrics_json TEXT,
      budget_usd REAL,
      report_token TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_hired_agents_ws_job ON hired_agents (workspace_id, job_id);

    -- The inbound cost/activity ledger: per-run execution events (exec_id keyed —
    -- the durable idempotency handle), period rollups (UPSERT by
    -- (hired_agent_id, period), the incrementBillingUsage pattern) and lifecycle
    -- events. connector_uses_json: [{connector, calls}].
    CREATE TABLE IF NOT EXISTS agent_activity (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL DEFAULT 'workspace',
      hired_agent_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      ts TEXT NOT NULL,
      exec_id TEXT,
      cost_usd REAL,
      tokens_in INTEGER,
      tokens_out INTEGER,
      status TEXT,
      duration_ms INTEGER,
      connector_uses_json TEXT,
      period TEXT,
      raw_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_agent_activity_agent ON agent_activity (workspace_id, hired_agent_id, ts);
    -- Durable idempotency: an execution report replayed with the same exec_id, or a
    -- rollup re-sent for the same period, can never double-count.
    CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_activity_exec ON agent_activity (hired_agent_id, exec_id) WHERE exec_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_activity_rollup ON agent_activity (hired_agent_id, period) WHERE kind = 'rollup';

    -- Role-intake dialogs (docs/concepts/role-intake-dialog.md, Phase 1): the
    -- captured conversation with a team lead / HR requestor and the evolving
    -- structured RoleBrief it fills. transcript_json is VoiceTurn[] (the shared
    -- cross-plane dialog contract); brief_json is a RoleBrief
    -- (pipeline/jobfit/rolebrief.py, roleBriefSchema on the TS side).
    -- jd_slug/job_id are stamped on promotion so a job can be walked back to
    -- the conversation that defined it. Operator-internal — no public token.
    CREATE TABLE IF NOT EXISTS role_intakes (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL DEFAULT 'workspace',
      title TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      lang TEXT,
      transcript_json TEXT,
      brief_json TEXT,
      shape TEXT,
      jd_slug TEXT,
      job_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_role_intakes_ws ON role_intakes (workspace_id, created_at);

    -- App master repo scans (db/repo-scans.ts, docs/features/app-master/README.md,
    -- phase P2): one row per "read this codebase into a RepoDossier" run. The row is
    -- the source of truth the poller reads, so a scan survives the operator
    -- navigating away — the same contract as tasks/campaign_packs.
    --
    -- repo_url / root_path are the operator's OWN input, echoed back so they can see
    -- what was scanned; root_path is only ever accepted behind the
    -- KP_APP_MASTER_REPO_ROOTS allow-list (repo-scan.ts), which is what stops this
    -- column from becoming a filesystem oracle. source is the dossier's provenance
    -- (llm = Claude Code read the repo in place, heuristic = the deterministic walk),
    -- NULL until the run finishes — a queued scan has no provenance to claim yet.
    CREATE TABLE IF NOT EXISTS repo_scans (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL DEFAULT 'workspace',
      repo_url TEXT,
      root_path TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      source TEXT,
      dossier_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_repo_scans_ws ON repo_scans (workspace_id, created_at);

    -- Operator companion (db/companion.ts, docs/features/companion/README.md) —
    -- Candi, the studio-side chat the operator talks to. Four tables:
    --
    -- companion_threads   one conversation. Titles are derived, never typed.
    -- companion_turns     the transcript. content is the literal text shown;
    --                     meta_json carries the turn's provenance (which episodes
    --                     it wrote, what it recalled, whether the model was
    --                     reachable) so a degraded reply stays diagnosable.
    -- companion_proposals the proposal-not-push law made storable: the companion
    --                     NEVER acts, it writes a row here and the operator
    --                     accepts it. status is open|accepted|declined and
    --                     resolved_at stamps the operator's answer.
    -- companion_brain_index  a READ MIRROR of the markdown brain at
    --                     ~/.personas/companion-brain, written by
    --                     pipeline/jobfit/companion_brain.py after the episode
    --                     file lands. path is relative to the brain root, so the
    --                     row is a pointer, never the record — deleting the DB
    --                     loses an index, deleting the tree loses the memory.
    --
    -- Deliberately NOT an fts5 table: a virtual table drops five shadow tables
    -- into sqlite_master, which the fail-closed tenancy guard (tenancy.ts) and
    -- the whole-DB dump/restore (db-portability.ts) both enumerate. Search here
    -- is LIKE over the excerpt; BM25 recall lives in the brain's OWN standalone
    -- index (companion_brain.py), which is also what makes recall work with kp
    -- shut down.
    CREATE TABLE IF NOT EXISTS companion_threads (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL DEFAULT 'workspace',
      title TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_companion_threads_ws ON companion_threads (workspace_id, created_at);

    CREATE TABLE IF NOT EXISTS companion_turns (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL DEFAULT 'workspace',
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      meta_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_companion_turns_ws ON companion_turns (workspace_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_companion_turns_thread ON companion_turns (thread_id, created_at);

    CREATE TABLE IF NOT EXISTS companion_proposals (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL DEFAULT 'workspace',
      kind TEXT NOT NULL,
      payload_json TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      thread_id TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_companion_proposals_ws ON companion_proposals (workspace_id, created_at);

    CREATE TABLE IF NOT EXISTS companion_brain_index (
      node_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL DEFAULT 'workspace',
      kind TEXT NOT NULL,
      excerpt TEXT,
      path TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_companion_brain_index_ws ON companion_brain_index (workspace_id, created_at);
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
    // The archetype checklist's still-unmet items for this entry's profile
    // (profile_cli `missingGaps`, JSON array of {check,label}) — recorded at
    // intake so the post-apply follow-up can ask the CANDIDATE the targeted gap
    // questions (completeness-followup.ts) that only they can answer, and so an
    // UNANSWERED gap stays on the record. Rewritten (never appended) whenever the
    // profile is rebuilt or a gap answer merges. NULL = nothing recorded.
    "ALTER TABLE pipeline_entries ADD COLUMN profile_gaps_json TEXT",
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
    // Tenant-level candidate-comms language default (backlog #34): the locale a
    // NULL-locale entry's letters render in (see comms-locale.resolveCommsLocale).
    // DEFAULT 'cs' backfills the existing default workspace — this deployment is
    // the ČS (Czech bank) seed, so unknown-language candidates get Czech, not the
    // UI's English fallback. Validated at read (getWorkspaceDefaultLocale).
    "ALTER TABLE workspaces ADD COLUMN default_locale TEXT NOT NULL DEFAULT 'cs'",
    // Identity foundation (P0): a workspace is a TEAM that belongs to an org.
    // org_id links it to its organization; type distinguishes a 'team' from a
    // future org-level pseudo-workspace. NULL on the legacy default row ⇒
    // backfilled to the default org in the seed block below.
    "ALTER TABLE workspaces ADD COLUMN org_id TEXT",
    "ALTER TABLE workspaces ADD COLUMN type TEXT",
    // Per-user permission overrides on a membership (P0) — see the memberships CREATE.
    "ALTER TABLE memberships ADD COLUMN capability_overrides TEXT",
    // First-run onboarding (per-user): when this person finished — or explicitly
    // skipped — the setup wizard. Both NULL = never seen ⇒ the / gate shows it.
    // Timestamps (not booleans) so support can see WHEN, and a skip can later be
    // distinguished from a completion (the getting-started checklist re-offers
    // itself to skippers). Workspace-level twin below covers open-dev/operator
    // sessions where no user id exists (current-user.ts short-circuits to null).
    "ALTER TABLE users ADD COLUMN onboarding_completed_at TEXT",
    "ALTER TABLE users ADD COLUMN onboarding_skipped_at TEXT",
    // First-run onboarding (workspace fallback): 'completed' | 'skipped' | NULL.
    // The authority when the session has no user claim (open dev mode, operator
    // password) — mirrors the default_locale per-workspace-scalar pattern.
    "ALTER TABLE workspaces ADD COLUMN onboarding_state TEXT",
    "ALTER TABLE channel_webhooks ADD COLUMN first_received_at TEXT",
    // E5 metric honesty: `received_count`/`first_received_at` stamp EVERY POST (probes,
    // health-checks, malformed integrations), so they overstate real leads. Track
    // ACCEPTED leads separately — incremented only when intake actually files a lead —
    // so "leads received" and time-to-first-lead reflect candidates, not pings.
    "ALTER TABLE channel_webhooks ADD COLUMN accepted_count INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE channel_webhooks ADD COLUMN first_accepted_at TEXT",
    // Org-scoped billing (org-plan Phase 3, data layer): billing is per-ORG —
    // one subscription + ledger per customer company, shared across its teams.
    // DEFAULT 'org-default' backfills every existing row to the single seeded
    // org so a pre-migration deployment reads byte-identically. billing_state's
    // column is nullable-then-backfilled (its legacy row predates the default);
    // billing_events' org_id is nullable ATTRIBUTION only (the idempotency PK
    // stays the provider's global event id). billing_usage is REBUILT below —
    // its PK must widen to (org_id, meter, period).
    "ALTER TABLE billing_state ADD COLUMN org_id TEXT",
    "ALTER TABLE billing_events ADD COLUMN org_id TEXT",
    "ALTER TABLE billing_credits ADD COLUMN org_id TEXT NOT NULL DEFAULT 'org-default'",
    "ALTER TABLE billing_alerts ADD COLUMN org_id TEXT NOT NULL DEFAULT 'org-default'",
    // Role-intake attachments (docs/features/intake/README.md): reference
    // material — a colleague's note or a saved JD — the dialog grounds on.
    // JSON list of {kind: "note"|"jd", title, text, jdSlug?}.
    "ALTER TABLE role_intakes ADD COLUMN attachment_json TEXT",
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

    -- W0.6b — candidate NPS. Captured on a TERMINAL outcome from the public status
    -- page, so the candidate-experience claim the rejection-feedback work rests on is
    -- measured rather than asserted. entry_id is the PRIMARY KEY: one response per
    -- application, so a link-holder cannot ballot-stuff their own outcome. A resubmit
    -- REPLACEs (people change their mind before they hit send twice); the original
    -- created_at is not preserved because a rewritten answer is a new answer.
    CREATE TABLE IF NOT EXISTS candidate_nps (
      entry_id TEXT PRIMARY KEY,
      score INTEGER NOT NULL,
      comment TEXT,
      created_at TEXT NOT NULL,
      workspace_id TEXT NOT NULL DEFAULT 'workspace'
    );
    CREATE INDEX IF NOT EXISTS idx_candidate_nps_ws ON candidate_nps (workspace_id, created_at DESC);

    -- W2.3 — outreach memory, per pipeline entry (candidate × role). dispatchOutreach
    -- used to gate on consent and fire with no record that it had ever run, so a campaign
    -- re-run mailed the same people again, including the ones who had already written
    -- back. The sends counter is what makes an inbound message a REPLY rather than a
    -- re-application (outreach-halt.ts); replied_at/manual_halt_at stop the sequence.
    CREATE TABLE IF NOT EXISTS outreach_state (
      entry_id TEXT PRIMARY KEY,
      sends INTEGER NOT NULL DEFAULT 0,
      last_sent_at TEXT,
      replied_at TEXT,
      manual_halt_at TEXT,
      workspace_id TEXT NOT NULL DEFAULT 'workspace'
    );
    CREATE INDEX IF NOT EXISTS idx_outreach_state_ws ON outreach_state (workspace_id);

    -- W1.1 — the external-id link table: the piece that makes an ATS sync IDEMPOTENT.
    -- ats-record.ts emits candidates outward keyed by kp's own entry id, which is fine for
    -- egress. Pulling candidates IN needs the other direction: the vendor's id for an
    -- application, so the second sync UPDATES the person it already imported instead of
    -- creating a twin. Without this table a nightly sync duplicates the entire pipeline
    -- every night, which is how an integration destroys a customer's funnel metrics.
    --
    -- The PK is (provider, external_id, workspace_id): ids are only unique within a
    -- vendor, and two tenants can legitimately connect the same ATS account.
    -- last_seen_stage is what the vendor last told us, so a re-sync can tell an actual
    -- stage change from a no-op re-send.
    CREATE TABLE IF NOT EXISTS ats_links (
      provider TEXT NOT NULL,
      external_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL DEFAULT 'workspace',
      entry_id TEXT NOT NULL,
      last_seen_stage TEXT,
      last_synced_at TEXT NOT NULL,
      PRIMARY KEY (provider, external_id, workspace_id)
    );
    CREATE INDEX IF NOT EXISTS idx_ats_links_entry ON ats_links (entry_id, workspace_id);
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
    // Tenant scope (P1): a team's authored openings. Seeded corpus rows keep
    // workspace_id NULL = the SHARED cross-company reference every team matches
    // against; authored JDs (a status was set) are backfilled to the default team
    // below. job-ingest.ts mirrors this ALTER on its own connection.
    "ALTER TABLE jobs ADD COLUMN workspace_id TEXT",
    // When the role first went live. status alone says whether a job is published
    // now, never since when, so any publish-anchored cycle metric (publish→hire,
    // publish→first offer) had no start date — which is why pipelineAnalytics
    // measures entry→hire instead. Stamped by setJobStatus on the first flip to
    // 'published' and left alone afterwards, so a close/republish keeps the
    // original cycle start. NULL = seeded corpus, or authored before this column.
    "ALTER TABLE jobs ADD COLUMN published_at TEXT",
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
    // Content-addressed candidate identity: the SHA-256 of the CV bytes (the same
    // per-CV content hash the analyze intake already computes for variant dedupe /
    // the cache key). Identity used to BE the filename — two filenames for one person
    // never linked, two "CV.pdf" collided, and re-running a cached CV+JD kept INSERTing
    // duplicate History rows. With this, the same content is one identity regardless
    // of filename: History collapses same-(cv_hash, jd) re-runs, the report links the
    // same person's other-job analyses, and a filename-derived label shared by two
    // different hashes surfaces a collision caution. NULL on legacy rows (never grouped).
    "ALTER TABLE analyses ADD COLUMN cv_hash TEXT",
    // Tenant scope (P2): the profiles domain (2nd scoped table). Same backfill below.
    "ALTER TABLE profiles ADD COLUMN workspace_id TEXT",
    // Source lineage (profile ↔ CV): the saved analysis a profile was built from,
    // its content hash (SHA-256 of the CV bytes), and that analysis's created_at.
    // Stamped from the source analysis at save (never from the client), so a NEWER
    // same-cv_hash analysis is detectable as "this profile was built from an older
    // CV". All NULL on legacy/hand-built rows (never grouped, never stale).
    "ALTER TABLE profiles ADD COLUMN source_analysis_slug TEXT",
    "ALTER TABLE profiles ADD COLUMN source_cv_hash TEXT",
    "ALTER TABLE profiles ADD COLUMN source_analyzed_at TEXT",
    // Divergence tracking ("rebuild that respects hand edits"): updated_at is stamped
    // on every content write, lineage_stamped_at whenever source lineage is (re)stamped.
    // updated_at > lineage_stamped_at ⇒ the profile was hand-edited after it was built
    // from its analysis, so a rebuild warns before overwriting. NULL on legacy rows ⇒
    // divergence unprovable ⇒ rebuild behaves exactly as before (no warning).
    "ALTER TABLE profiles ADD COLUMN updated_at TEXT",
    "ALTER TABLE profiles ADD COLUMN lineage_stamped_at TEXT",
    // Tenant scope (P1): the Library JD tables — a team's private drafts/openings +
    // their edit history. Backfilled to the default workspace below.
    "ALTER TABLE jds ADD COLUMN workspace_id TEXT",
    "ALTER TABLE jd_revisions ADD COLUMN workspace_id TEXT",
    // Tenant scope (P1): the pipeline audit trails — one team's events + GDPR consent
    // trail. Backfilled from each row's linked entry (entry-less events → default) below.
    "ALTER TABLE pipeline_events ADD COLUMN workspace_id TEXT",
    // UAT LUC-ANA-4 — the actor column for DBs created before it existed. Additive and
    // nullable with NO backfill, deliberately: there is no record of who took a decision
    // sealed before the column existed, and inventing one (defaulting to the operator,
    // to the owner, to "human") would manufacture exactly the accountability this item
    // exists to make real. A legacy row reads as "not identified" forever, which is the
    // truth about it (guardrail G3).
    "ALTER TABLE pipeline_events ADD COLUMN actor TEXT",
    "ALTER TABLE consent_events ADD COLUMN workspace_id TEXT",
    // Tenant scope (P1): the Channels surface — inbound webhook bindings + the comms
    // outbox (a team's outbound candidate messages). Backfilled below (the outbox from
    // its referenced entry; webhooks to the default workspace). channel_spend is rebuilt
    // separately — its single-column PK must widen to (channel, workspace_id).
    "ALTER TABLE channel_webhooks ADD COLUMN workspace_id TEXT",
    "ALTER TABLE dev_outbox ADD COLUMN workspace_id TEXT",
    // failure-truth-everywhere: WHY a send dead-lettered. comms.ts already computed a
    // precise reason per attempt ("http 503", "getaddrinfo ENOTFOUND …", a timeout) and
    // spent it on a console.error + comms.log line, then wrote the row without it — so
    // the Comms Center could say a message failed but never why, and the recruiter's
    // only recourse was server logs. Additive + nullable: legacy `failed` rows keep
    // reading as "no reason recorded", never as a fabricated one.
    "ALTER TABLE dev_outbox ADD COLUMN failure_detail TEXT",
    // JD archive (W8-4/JDL1): archived JDs drop out of listJds and the pickers,
    // but loadJd keeps serving them so existing analysis links never 404.
    "ALTER TABLE jds ADD COLUMN archived_at TEXT",
    // Backgrounded AI generation: a JD is created up front in an 'analyzing' state
    // and filled in by the detached jd_build task (survives navigation). NULL =
    // a legacy/manually-saved draft (treated as ready). 'ready' once the handler
    // wrote the body; 'failed' if the build errored (analysis_error carries why).
    "ALTER TABLE jds ADD COLUMN analysis_status TEXT",
    // The jd_build task that owns this JD's analysis — links the row to live
    // progress and lets a stuck build be found/retried.
    "ALTER TABLE jds ADD COLUMN analysis_task_id TEXT",
    // Failure message when analysis_status='failed'.
    "ALTER TABLE jds ADD COLUMN analysis_error TEXT",
    // Structured artifacts the build produced beyond the markdown body (role,
    // salary band + sources + provenance, repo snapshot, interview case, and the
    // selected options) — JSON, read by the JD detail view. NULL until ready.
    "ALTER TABLE jds ADD COLUMN analysis_json TEXT",
    // The recruiter's original build INTENT captured at Generate — the free-text
    // "describe the need" prompt plus the checklist options / output lang / role
    // facets / template selection the build actually took. JSON. Lets Duplicate
    // re-seed from intent (not the rendered output) and Retry replay even after the
    // task row is pruned. NULL on legacy rows (draft saves + pre-migration builds).
    "ALTER TABLE jds ADD COLUMN build_input_json TEXT",
    // DEVP5 — the candidate-facing language for this role's case artifacts
    // (brief/tasks, seed README+DECISIONS, interview narration), captured at
    // need intake. NULL ⇒ "en" when threaded to the dev-case CLIs.
    "ALTER TABLE dev_lifecycle ADD COLUMN lang TEXT",
    // Tenancy scoping (E0 Phase 1) — workspace_id on the per-tenant tables. NOT NULL
    // DEFAULT 'workspace' backfills existing rows to the single default workspace, so
    // reads/writes that pass the default stay correct while the column enables real
    // per-team isolation once callers thread the session workspace. See app/_lib/tenancy.ts.
    "ALTER TABLE campaign_packs ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'workspace'",
    // Dev-case surface (E0 Phase 1): recruiter enumeration reads (list cases/lifecycles/
    // postings/submissions) filter workspace_id; child rows (postings→submissions→
    // sessions→events) derive their tenant from the parent; by-id/token ops are exempt
    // (devcase-tenancy.test.ts).
    "ALTER TABLE dev_cases ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'workspace'",
    "ALTER TABLE dev_lifecycle ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'workspace'",
    "ALTER TABLE dev_postings ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'workspace'",
    "ALTER TABLE dev_submissions ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'workspace'",
    "ALTER TABLE dev_sessions ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'workspace'",
    "ALTER TABLE dev_session_events ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'workspace'",
    // Bug-ui-scan 2026-07-09 #1 — paste MAGNITUDE (char count) for a "paste" observed
    // event: the in-product bulk-paste authenticity tell. Without it the decisive -65
    // penalty could never fire, so a ghost-written live submission scored "authentic"
    // and could auto-promote. NULL for non-paste kinds and on legacy rows (which
    // predate observed paste capture). migrateExec tolerates the re-run on a DB whose
    // CREATE TABLE above already includes the column.
    "ALTER TABLE dev_session_events ADD COLUMN size INTEGER",
    // LLM-era controls #1: the server-computed hash-chain link (see CREATE TABLE above).
    // Legacy rows stay NULL — verifyDevSessionChain treats a NULL-hash prefix as
    // unverifiable rather than tampered.
    "ALTER TABLE dev_session_events ADD COLUMN hash TEXT",
    // LLM-era controls #6: one-shot naive-LLM baseline solutions frozen per case at
    // approval ({solutions: [{files, note}], promptVersion}). Evaluation diffs each
    // submission against them — never a penalty, but similarity aims the authorship
    // interview at what the human added beyond the bare model.
    "ALTER TABLE dev_cases ADD COLUMN baseline_json TEXT",
    // Durable skill profiles (E0 Phase 1): stamped from the submission's workspace on
    // issue; public token / by-submission_id reads are exempt (skill-profiles-tenancy.test.ts).
    "ALTER TABLE skill_profiles ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'workspace'",
    // SECURITY (bug-ui-scan-2026-07-09 #1): the PUBLIC access token — the sole auth on
    // /skill/[token] + the verify endpoint — must be an UNGUESSABLE CSPRNG value
    // (randomToken, ~192 bits), NOT the guessable, enumerable, time-ordered randomId the
    // mint used to reuse as the PK. Added additively: legacy rows keep access_token NULL
    // and stay reachable by their randomId PK (getSkillProfileByToken falls back to the
    // PK), so every already-shared credential link keeps verifying. New rows carry a PK
    // (internal id, randomId) AND a distinct CSPRNG access_token (the public value).
    "ALTER TABLE skill_profiles ADD COLUMN access_token TEXT",
    // interview_sessions (E0 Phase 1): stamped from the entry on create; the by-job
    // enumeration (interviewedForJob) filters workspace_id; by-id/token/entry_id ops are
    // exempt (interviews-tenancy.test.ts).
    "ALTER TABLE interview_sessions ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'workspace'",
    // tasks (E0 Phase 1): the UI poll/history reads + dedup + create filter/stamp
    // workspace_id; the by-id runner ops and the global boot-recovery / readiness probes
    // stay global (tasks-tenancy.test.ts).
    "ALTER TABLE tasks ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'workspace'",
    // Read/unread tracking for finished tasks (background-mode round, 2026-08-12):
    // NULL = the outcome has not been acknowledged in the Background-tasks view;
    // the TasksIndicator badge counts terminal rows with seen_at IS NULL so a
    // recruiter who navigated away can't miss a finish. Server-side (not a
    // localStorage watermark) so the ack survives browsers and sessions.
    "ALTER TABLE tasks ADD COLUMN seen_at TEXT",
    // L0 "pull on wake" (docs/concepts/local-first-edge.md §3.1) — a receiver row
    // becomes BIDIRECTIONAL. Until now a channel_webhooks row could only be PUSHED
    // to (the source POSTs to /api/channels/inbound/<token>), which silently loses
    // every delivery made while a local-first install is switched off. With a
    // pull_url set, the clock also PULLS: it GETs the source on each tick and files
    // whatever arrived since `pull_cursor` through the same lead-intake core. The
    // token/job/lang/workspace binding — and therefore the tenancy — is the row's,
    // unchanged; only the direction of travel is new.
    "ALTER TABLE channel_webhooks ADD COLUMN pull_url TEXT",
    // Encrypted at rest under KP_SECRET (ats-secret helpers), like every other
    // stored integration credential. Sent as a bearer token when pulling.
    "ALTER TABLE channel_webhooks ADD COLUMN pull_secret TEXT",
    // Opaque, source-owned resume marker echoed back as ?since= on the next pull.
    // NULL = never pulled ⇒ the first pull asks for the source's own default window
    // (we do NOT invent a start date and silently import a decade of leads).
    "ALTER TABLE channel_webhooks ADD COLUMN pull_cursor TEXT",
    "ALTER TABLE channel_webhooks ADD COLUMN last_pull_at TEXT",
    // failure-truth-everywhere (the dev_outbox.failure_detail precedent): WHY the
    // last pull failed, surfaced on the receiver row. NULL after a clean pull.
    "ALTER TABLE channel_webhooks ADD COLUMN last_pull_error TEXT",
    // Companion memory consent (WP4): 'connected' | 'birthed' | NULL. Whether
    // this workspace has agreed that Candi may keep a memory on this machine —
    // 'connected' = the operator adopted a brain that was already on disk,
    // 'birthed' = they asked for a fresh one, NULL = never asked or skipped.
    // Skipping stamps NOTHING, so the column stays null and the dock runs
    // memoryless (app/_lib/companion-brain.ts owns the rule, including the
    // implicit-consent arm for installs that already have episodes). A
    // per-workspace scalar in the default_locale / onboarding_state shape rather
    // than a new table: the value is one word per tenant, and this repo has no
    // key-value settings store to put it in.
    "ALTER TABLE workspaces ADD COLUMN companion_brain_consent TEXT",
    // ONE THREAD (JD → assignment): the job this assignment was cut for, i.e.
    // `jd-<slug>` for the JD the recruiter picked in DevNeedForm. Until now the pick
    // survived ONLY as `need_json.jdSlug` — a value inside an opaque blob that no
    // query could join on — so the Jobs surface could not tell that a role had a work
    // sample at all, and nothing downstream (voice screen, scoring) could travel back
    // from the assignment to the opening it belongs to.
    //
    // Nullable BY CONTRACT, and the NULL is load-bearing rather than a gap: the
    // JD → Job ingest is best-effort (docs/features/jobs/README.md — `jobIngested:
    // false`), so a saved JD does not always have a `jd-<slug>` row. Writing the id
    // anyway would mint a dangling reference that reads exactly like a real link;
    // resolveCaseJobId (db/devcase.ts) therefore verifies the row EXISTS and leaves
    // the column NULL when it does not. The case still knows its JD (need_json.jdSlug,
    // surfaced as DevCaseRecord.jdSlug), and the UI says "picked, not sourced" instead
    // of showing a link that goes nowhere.
    //
    // dev_postings deliberately does NOT get a copy: a posting is a child of exactly
    // one case (`case_id`) and every consumer already resolves the case from it
    // (getPostingByToken → getDevCase), so a second column would be a denormalized
    // duplicate with its own way to drift.
    "ALTER TABLE dev_cases ADD COLUMN job_id TEXT",
    // ONE THREAD (assignment → board): which dev case, and which submission, a
    // pipeline entry came out of.
    //
    // Both facts USED to be encoded in the ids themselves — `jobId: "dc-<caseId>"`
    // and `candidateId: "ds-<submissionId>"` minted by devcase-run — and that is
    // precisely the defect: an id that has to carry a second meaning cannot also be
    // the real job / the real person, so a candidate who came in through the JD's
    // own opening existed TWICE on the board, and Matrix/Match could not rank the
    // synthetic half (no `profiles` row behind a "ds-" id). Moving the two links
    // into their own columns frees `job_id`/`candidate_id` to hold the identities
    // the rest of the app already uses, WITHOUT losing what the prefixes encoded.
    //
    // Nullable, and NULL is the overwhelming majority: every entry that did not come
    // from an assignment carries neither. A legacy "dc-"/"ds-" entry also carries
    // neither — devcase-identity.ts falls back to parsing the prefix for exactly
    // those rows, so nothing written before this change stops resolving.
    "ALTER TABLE pipeline_entries ADD COLUMN dev_case_id TEXT",
    "ALTER TABLE pipeline_entries ADD COLUMN dev_submission_id TEXT",
  ]) {
    // Use the same loud-fail migrator as the loop above: a bare `catch {}` here
    // swallowed real failures (corruption, I/O, lock contention) and booted a
    // structurally-broken DB — the exact "why is everything empty" trap migrateExec
    // was written to prevent. It tolerates only the benign "already applied" error.
    migrateExec(sql);
  }
  // The public skill-profile verify/view resolves a presented token by its CSPRNG
  // access_token (new credentials); index it like the other single-row token lookups.
  // Created AFTER the ALTER loop above so a legacy DB already holds the column.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_skill_profiles_access_token ON skill_profiles (access_token)`);
  // Content-addressed identity lookups: History grouping (newest per cv_hash+jd),
  // cross-job linkage (same cv_hash, other JDs), and the label-collision probe all
  // filter analyses by (workspace_id, cv_hash). Created AFTER the ALTER loop so a
  // legacy DB already holds the column.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_analyses_cv_hash ON analyses (workspace_id, cv_hash)`);
  // Profile ↔ CV staleness: profileStaleness joins profiles to analyses on
  // (workspace_id, source_cv_hash) to find a newer same-CV analysis. Created AFTER
  // the ALTER loop so a legacy DB already holds the column.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_profiles_source_cv_hash ON profiles (workspace_id, source_cv_hash)`);
  // ONE THREAD: "which assignments were cut for this job?" is a per-team lookup keyed
  // exactly like every other dev-case enumeration (workspace first). Created AFTER the
  // ALTER loop so a legacy DB already holds the column.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_dev_cases_job ON dev_cases (workspace_id, job_id)`);
  // ONE THREAD: "which board entries came out of this assignment?" — the reverse of
  // the link promote writes, and the read the case detail needs. Created AFTER the
  // ALTER loop so a legacy DB already holds the column.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_pipeline_dev_case ON pipeline_entries (workspace_id, dev_case_id)`);
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
  // Publish idempotency (bug-ui-scan-2026-07-09 (dev-case-authoring-publishing #4)):
  // at most ONE OPEN posting per (workspace, case, channel). The partial UNIQUE index
  // turns createPosting's INSERT ... ON CONFLICT DO NOTHING into a hard guarantee, so a
  // concurrent / multi-tab / reload re-publish can't mint a second live apply token for
  // one case and split its submissions across two tokens. A CLOSED posting is outside
  // the index, so a deliberate re-publish after closing still mints a fresh posting.
  // Guarded like the submissions index — a legacy DB with duplicate OPEN postings keeps
  // the app-level reuse (createPosting's read-then-insert) instead of the index.
  try {
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_dev_postings_open
         ON dev_postings (workspace_id, case_id, channel) WHERE status = 'open'`
    );
  } catch {
    /* pre-existing duplicate open postings prevent the unique index; skip */
  }
  // Atomic task dedup across connections (the scheduler ticks on its own connection
  // and an external cron can hit /api/automation/run): a partial UNIQUE index forbids
  // two ACTIVE rows sharing a dedupe_key, turning startTask's app-level read-then-write
  // into a hard guarantee. Guarded like the submissions index — a legacy DB with
  // active duplicates keeps the app-level coalescing instead.
  try {
    // Tenant (P1): the dedup uniqueness is PER-TEAM — two teams may legitimately have an
    // active task with the same dedupe_key (e.g. "screen entry X"). Widen the DB guarantee
    // to (workspace_id, dedupe_key) to match getActiveTaskByDedupe's app-level scope; the
    // NEW name keeps this idempotent across boots (drop the legacy dedupe_key-only index).
    // Single-tenant-identical: workspace_id is the constant 'workspace', so uniqueness
    // still reduces to dedupe_key within the one team.
    db.exec(`DROP INDEX IF EXISTS uq_tasks_active_dedupe`);
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_active_dedupe_ws
         ON tasks (workspace_id, dedupe_key) WHERE status IN ('queued','running')`
    );
  } catch {
    /* pre-existing active duplicates prevent the unique index; skip */
  }
  // Recruiter feedback door: one row per in-product "Send feedback" submission
  // (message + optional reply email + the route it was sent from + the running
  // app version). Workspace-scoped like candidate_nps — a team's feedback feeds
  // that team's operator view, never another tenant's. Idempotent CREATE (no
  // ALTER migration needed): the table is new-in-full, so a legacy DB simply
  // gains it on boot (the jd_revisions / consent_events pattern).
  db.exec(`
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message TEXT NOT NULL,
      email TEXT,
      route TEXT,
      app_version TEXT,
      workspace_id TEXT NOT NULL DEFAULT 'workspace',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_feedback_ws ON feedback (workspace_id, created_at DESC);
  `);
  // Tenant foundation (P2): ensure the single default workspace row exists ('workspace'
  // matches DEFAULT_WORKSPACE in auth/session.ts and billing's id).
  db.prepare(`INSERT OR IGNORE INTO workspaces (id, name, created_at) VALUES (?, ?, ?)`).run("workspace", "Default workspace", new Date().toISOString());
  // Identity foundation (P0): the default organization the single workspace (team)
  // belongs to. The deployed tenant is Česká spořitelna (matches the ČS job/
  // candidate seed). Backfill the default workspace's org_id + type once
  // (idempotent — only touches rows the migration left NULL).
  db.prepare(`INSERT OR IGNORE INTO organizations (id, name, domain, created_at) VALUES (?, ?, ?, ?)`).run(
    "org-default",
    "Česká spořitelna",
    "csas.cz",
    new Date().toISOString(),
  );
  db.prepare(`UPDATE workspaces SET org_id = 'org-default' WHERE org_id IS NULL`).run();
  db.prepare(`UPDATE workspaces SET type = 'team' WHERE type IS NULL`).run();
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_analyses_workspace ON analyses (workspace_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_profiles_workspace ON profiles (workspace_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_jds_workspace ON jds (workspace_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_jd_revisions_workspace ON jd_revisions (workspace_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_workspace ON jobs (workspace_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_pipeline_events_workspace ON pipeline_events (workspace_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_consent_events_workspace ON consent_events (workspace_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_channel_webhooks_workspace ON channel_webhooks (workspace_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_dev_outbox_workspace ON dev_outbox (workspace_id)`);
  } catch {
    /* index already exists */
  }
  // KP_EMPTY=1 (npm run dev:empty) skips ALL fixture content — the ČS demo corpus,
  // candidates, analyses, pipeline, example JD, seed members — so the app boots as a
  // truly blank tenant for first-run/onboarding verification. Structural bootstrap
  // above (schema, default workspace/org) still runs: a real deployment has it too.
  if (fixtureSeedEnabled()) {
    seedExampleJd(db);
    seedOrgMembers(db);
    seedJobs(db);
    seedCandidates(db);
    seedAnalyses(db);
    seedPipeline(db);
    seedBenchmarkTeam(db); // a 2nd org team so the Phase-2 org benchmark (org_id-join) has cross-team data
    // A fixture-seeded tenant is an ESTABLISHED demo environment, not a first
    // run — mark it onboarded so the setup wizard doesn't ambush existing dev
    // DBs. COALESCE keeps a real recorded state; dev:empty (KP_EMPTY=1) skips
    // this whole block, so the blank tenant stays NULL and the wizard fires.
    db.prepare(`UPDATE workspaces SET onboarding_state = COALESCE(onboarding_state, 'completed') WHERE id = 'workspace'`).run();
  }
  migratePipelineStages(db); // remap any legacy 7-stage rows to the 5-stage model
  backfillDeclinedStatus(db); // split candidate declines out of overloaded `rejected`

  // Tenant scope (P2): backfill ANY analyses row missing a workspace_id (legacy
  // rows AND freshly-seeded ones) to the default workspace. After all seeders so
  // it's order-independent — a seeded row that didn't stamp the column is caught.
  db.prepare(`UPDATE analyses SET workspace_id = ? WHERE workspace_id IS NULL`).run("workspace");
  db.prepare(`UPDATE profiles SET workspace_id = ? WHERE workspace_id IS NULL`).run("workspace");
  db.prepare(`UPDATE jds SET workspace_id = ? WHERE workspace_id IS NULL`).run("workspace");
  db.prepare(`UPDATE jd_revisions SET workspace_id = ? WHERE workspace_id IS NULL`).run("workspace");
  // Jobs: authored openings (a status was set) belong to the default team; seeded
  // corpus jobs (NULL status) stay workspace_id NULL = the shared reference corpus.
  db.prepare(`UPDATE jobs SET workspace_id = 'workspace' WHERE workspace_id IS NULL AND status IS NOT NULL`).run();
  // Pipeline audit trails: backfill each row's workspace from its linked entry (an
  // entry-less event, e.g. ko_declined, falls back to the default workspace).
  db.prepare(
    `UPDATE pipeline_events SET workspace_id = COALESCE((SELECT pe.workspace_id FROM pipeline_entries pe WHERE pe.id = pipeline_events.entry_id), 'workspace') WHERE workspace_id IS NULL`
  ).run();
  db.prepare(
    `UPDATE consent_events SET workspace_id = COALESCE((SELECT pe.workspace_id FROM pipeline_entries pe WHERE pe.id = consent_events.entry_id), 'workspace') WHERE workspace_id IS NULL`
  ).run();
  // Channels: inbound webhooks belong to the team that minted them (default). The comms
  // outbox derives each message's workspace from its referenced entry (ref = entry id),
  // falling back to the default for entry-less/system messages.
  db.prepare(`UPDATE channel_webhooks SET workspace_id = 'workspace' WHERE workspace_id IS NULL`).run();
  db.prepare(
    `UPDATE dev_outbox SET workspace_id = COALESCE((SELECT pe.workspace_id FROM pipeline_entries pe WHERE pe.id = dev_outbox.ref), 'workspace') WHERE workspace_id IS NULL`
  ).run();
  // Run one create-copy-drop-rename PK widening ATOMICALLY and RESUMABLY. SQLite can't
  // ALTER a PRIMARY KEY, so the three widenings below rebuild their table — and a rebuild
  // written as four bare statements is a boot wedge waiting to happen: a process killed
  // between the CREATE and the RENAME leaves an orphan `<t>_new` while the PRAGMA guard
  // still reads "not yet widened", so the next boot re-enters the block, the bare
  // `CREATE TABLE <t>_new` throws "table already exists", and — because this path does NOT
  // go through migrateExec — nothing catches it: ensureDb() throws and the app will not
  // start until an operator drops the orphan by hand. Two guards fix that: drop any orphan
  // scratch table first, and run the swap inside a transaction so it commits or rolls back
  // whole. Uses db.transaction rather than a raw `BEGIN;/COMMIT;` inside exec (the
  // group-eval.ts idiom) because a raw BEGIN in an exec that throws mid-statement leaves
  // the transaction OPEN on the connection, corrupting every later step of this function.
  // Failures are NOT swallowed: an unwidened PK is a live cross-tenant correctness problem
  // and must stay as loud as migrateExec's own unexpected-error path.
  const rebuildTable = (scratch: string, ddl: string) => {
    db.transaction(() => {
      db.exec(`DROP TABLE IF EXISTS ${scratch};`);
      db.exec(ddl);
    })();
  };

  // ONE THREAD backfill (dev_cases.job_id): an assignment created before the column
  // existed carries its JD only inside need_json. Recover the link for every legacy row
  // whose picked JD actually HAS an ingested `jd-<slug>` job — and only those, so the
  // column keeps the contract its comment states: an id here resolves. A JD whose
  // best-effort ingest never ran stays NULL and reads as "picked, not sourced" rather
  // than as a dangling reference.
  //
  // Written in JS rather than one UPDATE…json_extract so the `jd-` prefix keeps coming
  // from jdJobId — the single owner of the JD↔Job identity contract (jd-limits.ts) —
  // instead of being hand-interpolated into SQL a second time. Bounded and idempotent:
  // only rows still missing the column are read, so this is a no-op on every boot after
  // the first, and it never overwrites a link a writer already made.
  const unlinkedCases = db
    .prepare(`SELECT id, need_json FROM dev_cases WHERE job_id IS NULL AND need_json IS NOT NULL`)
    .all() as { id: string; need_json: string }[];
  if (unlinkedCases.length > 0) {
    const jobExists = db.prepare(`SELECT 1 FROM jobs WHERE id = ?`);
    const linkCase = db.prepare(`UPDATE dev_cases SET job_id = ? WHERE id = ? AND job_id IS NULL`);
    for (const row of unlinkedCases) {
      const need = safeRowParse<{ jdSlug?: unknown }>(row.need_json, "devCase.need.backfill", row.id);
      const slug = typeof need?.jdSlug === "string" ? need.jdSlug.trim() : "";
      if (!slug) continue;
      const jobId = jdJobId(slug);
      if (!jobExists.get(jobId)) continue;
      linkCase.run(jobId, row.id);
    }
  }
  // channel_spend: widen the single-column PK to (channel, workspace_id) so each team
  // keeps its own per-channel spend. One-time rebuild (SQLite can't alter a PK); guarded
  // by the absence of the workspace_id column so it runs exactly once.
  const spendCols = db.prepare(`PRAGMA table_info(channel_spend)`).all() as { name: string }[];
  if (!spendCols.some((c) => c.name === "workspace_id")) {
    rebuildTable(
      "channel_spend_new",
      `CREATE TABLE channel_spend_new (
         channel TEXT NOT NULL,
         amount_czk REAL NOT NULL,
         updated_at TEXT NOT NULL,
         workspace_id TEXT NOT NULL DEFAULT 'workspace',
         PRIMARY KEY (channel, workspace_id)
       );
       INSERT INTO channel_spend_new (channel, amount_czk, updated_at, workspace_id)
         SELECT channel, amount_czk, updated_at, 'workspace' FROM channel_spend;
       DROP TABLE channel_spend;
       ALTER TABLE channel_spend_new RENAME TO channel_spend;`
    );
  }
  // analytics_targets: same additive migration as channel_spend — widen the single-column
  // PK to (metric, workspace_id) so each team keeps its own hiring goals (funnel conversion
  // targets, the time-to-hire goal, and the recruiter_hourly_czk rate that drives the
  // automation-ROI figure). One-time rebuild (SQLite can't alter a PK); guarded by the
  // absence of the workspace_id column so it runs exactly once. Existing rows keep working
  // for the default workspace.
  const targetCols = db.prepare(`PRAGMA table_info(analytics_targets)`).all() as { name: string }[];
  if (!targetCols.some((c) => c.name === "workspace_id")) {
    rebuildTable(
      "analytics_targets_new",
      `CREATE TABLE analytics_targets_new (
         metric TEXT NOT NULL,
         target_value REAL NOT NULL,
         updated_at TEXT NOT NULL,
         workspace_id TEXT NOT NULL DEFAULT 'workspace',
         PRIMARY KEY (metric, workspace_id)
       );
       INSERT INTO analytics_targets_new (metric, target_value, updated_at, workspace_id)
         SELECT metric, target_value, updated_at, 'workspace' FROM analytics_targets;
       DROP TABLE analytics_targets;
       ALTER TABLE analytics_targets_new RENAME TO analytics_targets;`
    );
  }
  // Org-scoped billing (org-plan Phase 3, data layer) — the org_id backfills the
  // ALTER loop above can't express:
  // 1) billing_state's legacy single row (id 'workspace') predates the column, so
  //    stamp it to the seeded org; one row per org is then enforced by the unique
  //    index (try/catch like uq_tasks: a hand-edited legacy DB with duplicates
  //    keeps booting, just without the constraint).
  db.prepare(`UPDATE billing_state SET org_id = 'org-default' WHERE org_id IS NULL`).run();
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_state_org ON billing_state (org_id)`);
  } catch {
    /* pre-existing duplicate org rows prevent the unique index; skip */
  }
  // 2) billing_usage: widen the (meter, period) PK to (org_id, meter, period) so each
  //    org keeps its own monthly meter counters. One-time rebuild (SQLite can't alter
  //    a PK — the channel_spend/analytics_targets pattern); guarded by the absence of
  //    the org_id column so it runs exactly once. Existing counters belong to the
  //    single seeded org.
  const usageCols = db.prepare(`PRAGMA table_info(billing_usage)`).all() as { name: string }[];
  if (!usageCols.some((c) => c.name === "org_id")) {
    rebuildTable(
      "billing_usage_new",
      `CREATE TABLE billing_usage_new (
         org_id TEXT NOT NULL DEFAULT 'org-default',
         meter TEXT NOT NULL,
         period TEXT NOT NULL,
         qty INTEGER NOT NULL DEFAULT 0,
         PRIMARY KEY (org_id, meter, period)
       );
       INSERT INTO billing_usage_new (org_id, meter, period, qty)
         SELECT 'org-default', meter, period, qty FROM billing_usage;
       DROP TABLE billing_usage;
       ALTER TABLE billing_usage_new RENAME TO billing_usage;`
    );
  }
  // Null-contract heal: `approval_detail` is nullable and "no detail" is NULL (its
  // sibling approval_kind clears to NULL), but earlier clear/insert paths wrote '',
  // so a "cleared" detail read back as "" on some rows and NULL on others. Now that
  // every writer uses NULL, fold the legacy empty strings to NULL so consumers see
  // one canonical "no detail". Idempotent (a no-op once healed; new rows never write '').
  db.prepare(`UPDATE pipeline_entries SET approval_detail = NULL WHERE approval_detail = ''`).run();
  // Self-defending tenancy guard: if KP_MULTI_WORKSPACE is enabled, REFUSE to boot
  // with any unscoped per-tenant table (machine-checked against the canonical
  // manifest in tenancy.ts) rather than silently serving cross-tenant data. The
  // env flag is documented as the "flip me to enable" switch; this turns flipping
  // it on an incompletely-scoped DB into a loud, actionable failure instead of a
  // silent PII breach. No-op in the default single-tenant lock.
  assertTenancyReady(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => (r as { name: string }).name),
    multiWorkspaceEnabled(),
  );
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

// Identity foundation (P0): seed the default org's team with the six Česká
// spořitelna members (was the mocked org-page roster). Raw SQL — the db.ts store
// helpers can't run here (they re-enter ensureDb mid-init). Empty-org guard so a
// later boot never re-creates a member an admin removed. No passwords: seeded
// users are identity+role only until an invite sets a credential (open dev already
// grants owner access, so no seeded login is needed).
function seedOrgMembers(db: Database.Database): void {
  if (seedAlreadyRan(db, "org-members")) return;
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE org_id = 'org-default'`).get() as { n: number };
  if (adoptedExistingSeed(db, "org-members", n)) return;
  const members: { id: string; name: string; email: string; role: string; status: string }[] = [
    { id: "usr-seed-petra", name: "Petra Nováková", email: "petra.novakova@csas.cz", role: "owner", status: "active" },
    { id: "usr-seed-jan", name: "Jan Dvořák", email: "jan.dvorak@csas.cz", role: "admin", status: "active" },
    { id: "usr-seed-marketa", name: "Markéta Svobodová", email: "marketa.svobodova@csas.cz", role: "recruiter", status: "active" },
    { id: "usr-seed-tomas", name: "Tomáš Horák", email: "tomas.horak@csas.cz", role: "hiring_manager", status: "active" },
    { id: "usr-seed-lucie", name: "Lucie Marková", email: "lucie.markova@csas.cz", role: "recruiter", status: "invited" },
    { id: "usr-seed-david", name: "David Beneš", email: "david.benes@csas.cz", role: "viewer", status: "disabled" },
  ];
  const now = new Date().toISOString();
  const insUser = db.prepare(`INSERT OR IGNORE INTO users (id, org_id, email, name, status, created_at) VALUES (?, 'org-default', ?, ?, ?, ?)`);
  const insMem = db.prepare(`INSERT OR IGNORE INTO memberships (id, user_id, workspace_id, role, created_at) VALUES (?, ?, 'workspace', ?, ?)`);
  for (const m of members) {
    insUser.run(m.id, m.email, m.name, m.status, now);
    insMem.run(`mem-seed-${m.id}`, m.id, m.role, now);
  }
  markSeedRan(db, "org-members");
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
  if (seedAlreadyRan(db, "jobs")) return;
  const count = db.prepare(`SELECT COUNT(*) AS n FROM jobs`).get() as { n: number };
  if (adoptedExistingSeed(db, "jobs", count.n)) return;
  const jobs = loadSeedArray<JobRecord>("jobs", SEED_JOBS_PATH);
  // A missing or unreadable seed file is NOT a completed seed — leave the mark unset so
  // a later boot with the file present still seeds. loadSeedArray already records the
  // read/parse failure in seed health.
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
  markSeedRan(db, "jobs");
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
  //
  // NON-DESTRUCTIVE upsert, and PRISTINE-ONLY (the seedAnalyses fix, applied to its
  // sibling — this seeder still used `INSERT OR REPLACE`, i.e. delete-then-insert
  // over a 7-column list that predates workspace_id / the lineage + divergence
  // stamps). Two live consequences, both silent and timer-driven:
  //   1. GDPR. anonymizeEntry → anonymizeProfile masks the label and scrubs the CV
  //      payload IN PLACE (name, raw CV text, contact, evidence quotes). 54 of the
  //      shipped pipeline entries point at `cand-*` profiles, so an erasure request
  //      honoured on Monday was UNDONE by Tuesday's restart: REPLACE re-inserted the
  //      original name + full payload straight from the committed seed JSON.
  //   2. Recruiter edits + lineage. updateProfile / setProfileLineage writes were
  //      reverted, and source_analysis_slug / source_cv_hash / source_analyzed_at /
  //      updated_at / lineage_stamped_at (plus workspace_id) were re-NULLed on every
  //      boot — so profileDivergence could never warn before a rebuild clobbered an
  //      edit, and profileStaleness never saw a seeded profile's lineage.
  // `updated_at IS NULL` is the exact "the app has never written this row" marker:
  // the seed INSERT below omits the column, while saveProfile stamps it at birth and
  // updateProfile on every content write. So an untouched seed row still refreshes
  // from a regenerated corpus (the documented purpose), and a row the product has
  // written — edited, rebuilt, or ERASED — is left exactly as the product left it.
  const records = loadSeedArray<Record<string, unknown>>("candidates", SEED_CANDIDATES_PATH);
  if (!records) return;
  const insert = db.prepare(
    `INSERT INTO profiles (id, label, archetype, role_family, completeness, payload_json, created_at)
     VALUES (@id, @label, @archetype, @role_family, @completeness, @payload_json, @created_at)
     ON CONFLICT(id) DO UPDATE SET
       label = excluded.label,
       archetype = excluded.archetype,
       role_family = excluded.role_family,
       completeness = excluded.completeness,
       payload_json = excluded.payload_json,
       created_at = excluded.created_at
     WHERE profiles.updated_at IS NULL`
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
  //
  // NON-DESTRUCTIVE upsert (bug-ui-scan-2026-07-09 data-store #1): this was
  // `INSERT OR REPLACE`, which is delete-then-insert — and the column list below
  // predates disposition/decision_note/review_flags/github_json/workspace_id, so
  // every reboot RESET a recruiter's disposition + GitHub deep-dive on the SHIPPED
  // seeded-candidate population to NULL (silent, timer-driven data loss; only
  // workspace_id was re-healed by the post-seed backfill). `ON CONFLICT(slug) DO
  // UPDATE SET` now refreshes ONLY the seed-owned columns (label/jd/score/role/
  // seniority/payload/created_at) and never touches the human- or later-computed
  // columns, so a re-seed leaves an edited row's decisions intact. A genuinely new
  // seed row still plain-INSERTs (workspace_id NULL → backfilled to 'workspace' below).
  const records = loadSeedArray<Record<string, unknown>>("analyses", SEED_ANALYSES_PATH);
  if (!records) return;
  const insert = db.prepare(
    `INSERT INTO analyses (slug, candidate_label, jd_slug, score, role_family, seniority, payload_json, created_at)
     VALUES (@slug, @candidate_label, @jd_slug, @score, @role_family, @seniority, @payload_json, @created_at)
     ON CONFLICT(slug) DO UPDATE SET
       candidate_label = excluded.candidate_label,
       jd_slug = excluded.jd_slug,
       score = excluded.score,
       role_family = excluded.role_family,
       seniority = excluded.seniority,
       payload_json = excluded.payload_json,
       created_at = excluded.created_at
     -- …but NEVER over an ERASED candidate. The columns this upsert refreshes are
     -- exactly the two anonymizeEntry scrubs (candidate_label → "First L.",
     -- payload_json → PII stripped of name / rawText / contact / evidence quotes), so
     -- protecting disposition + github_json alone still let a boot re-write the CV
     -- payload straight back from the committed seed JSON: 54 shipped pipeline entries
     -- resolve to a seeded analysis by label, and erasure that undoes itself on the next
     -- restart is worse than no erasure at all. The predicate is anonymizeEntry's OWN
     -- link (normalized label + same workspace) keyed on the durable anonymized_at stamp
     -- rather than on label drift — erasure anonymizes in place and never deletes the
     -- entry, so the suppression stays true for the life of the row.
     WHERE NOT EXISTS (
       SELECT 1 FROM pipeline_entries pe
        WHERE pe.anonymized_at IS NOT NULL
          AND pe.workspace_id = analyses.workspace_id
          AND LOWER(TRIM(pe.candidate_label)) = LOWER(TRIM(analyses.candidate_label))
     )`
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
  // ONE THREAD — the assignment (dev case) this entry came out of, and the
  // submission that was promoted, when either applies. NULL on every entry that did
  // not come from an assignment, AND on the legacy entries that encoded the same two
  // facts in their ids ("dc-<caseId>" / "ds-<submissionId>"): read them through
  // devCaseIdForEntry / submissionIdForEntry (devcase-identity.ts), which falls back
  // to the prefixes for exactly those rows. Never read the prefixes directly.
  devCaseId: string | null;
  devSubmissionId: string | null;
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
  // The team this entry belongs to. Surfaced BECAUSE its absence was the root of a
  // whole family of cross-tenant defects: the row has always carried workspace_id,
  // but rowToEntry dropped it, so every function handed a PipelineEntry had to be
  // passed the tenant separately — and ~24 call sites simply didn't, silently
  // falling back to DEFAULT_WORKSPACE_ID (blank automation events, comms envelopes
  // with no candidate context, rejection letters missing their feedback). The
  // automation path had already worked around this by widening the type locally
  // (`AutomationEntry = PipelineEntry & { workspaceId }`), which was the tell.
  //
  // Safe on the wire: /api/pipeline serves this type to the RECRUITER client,
  // which already knows its own workspace, and every candidate-facing token route
  // projects explicit fields rather than serializing a row (see the erasure-token
  // note above, and publicInviteView in api/schedule/[token]).
  workspaceId: string;
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
    // UAT LUC-ANA-4 — WHO took this action, in the decision-chain actor vocabulary
    // ("human:Petra Nováková" / "human:recruiter" / "auto:screen-wave"). Omitted by a
    // writer that cannot name an actor; the column then stays NULL and the surface
    // reads "not identified" rather than crediting anyone (guardrail G3). Never
    // client-supplied — every caller derives it server-side.
    actor?: string | null;
    // Tenant (P1): the team the event belongs to. AUTO-DERIVED from the linked
    // entry when omitted (the common case — an event always mirrors its entry's
    // tenant), so the ~15 recordEvent call sites don't each have to thread it.
    // Entry-less events (ko_declined) pass it explicitly or default to 'workspace'.
    workspaceId?: string;
  }
): void {
  const workspaceId =
    e.workspaceId ??
    (e.entryId
      ? (db.prepare(`SELECT workspace_id FROM pipeline_entries WHERE id = ?`).get(e.entryId) as { workspace_id?: string } | undefined)
          ?.workspace_id
      : undefined) ??
    "workspace";
  db.prepare(
    `INSERT INTO pipeline_events (entry_id, candidate_label, job_title, archetype, kind, from_stage, to_stage, detail, created_at, actor, workspace_id)
     VALUES (@entry_id, @candidate_label, @job_title, @archetype, @kind, @from_stage, @to_stage, @detail, @created_at, @actor, @workspace_id)`
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
    // Empty string is treated as absent: a blank actor is not an identification.
    actor: e.actor?.trim() || null,
    workspace_id: workspaceId,
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
  if (seedAlreadyRan(db, "pipeline")) return;
  const count = db.prepare(`SELECT COUNT(*) AS n FROM pipeline_entries`).get() as { n: number };
  if (adoptedExistingSeed(db, "pipeline", count.n)) return;
  const entries = loadSeedArray<PipelineEntry>("pipeline", SEED_PIPELINE_PATH);
  // As in seedJobs: an unreadable seed file leaves the mark unset so a later boot retries.
  if (!entries) return;
  const nowMs = Date.now();
  const day = 86_400_000;
  const insert = db.prepare(
    `INSERT OR IGNORE INTO pipeline_entries
       (id, candidate_id, candidate_label, archetype, role_family, job_id, job_title,
        stage, match_score, status, approval_kind, approval_detail, created_at, stage_changed_at, updated_at, locale)
     VALUES (@id, @candidate_id, @candidate_label, @archetype, @role_family, @job_id, @job_title,
        @stage, @match_score, @status, @approval_kind, @approval_detail, @created_at, @stage_changed_at, @updated_at, @locale)`
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
        // Seed rows rarely carry a locale; NULL resolves to the workspace default
        // ('cs' for the ČS seed) at dispatch — see comms-locale.resolveCommsLocale.
        locale: e.locale ?? null,
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
  markSeedRan(db, "pipeline");
}
