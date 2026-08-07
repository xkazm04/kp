// Canonical tenancy manifest — the SINGLE machine-checked source of truth for
// "which tables are workspace-scoped", replacing the free-text prose in
// workspace-lock.ts (which had drifted in BOTH directions: it omitted
// pipeline_entries' column and implied scoping the read path doesn't deliver).
//
// The invariant: before multi-workspace (KP_MULTI_WORKSPACE) can be safely enabled,
// every persistent table that holds per-tenant data must have its read+write paths
// filter on `workspace_id`. We model that as an explicit allowlist of VERIFIED-scoped
// tables plus a short allowlist of genuinely-global EXEMPT tables; EVERYTHING ELSE is
// required by default (fail closed), so a newly-added table can't silently re-open a
// cross-tenant gap — it shows up as a gap until it is scoped + listed here.
//
// Pure + import-free (like workspace-lock.ts) so the policy is unit-testable and the
// boot-time DB assertion (db/core.ts) is a thin wrapper that feeds in the live table
// list. A table counts as "scoped" only when its read AND write paths are verified to
// filter on workspace_id — proven by a colocated `*-tenancy.test.ts`. Carrying the
// COLUMN alone is NOT enough (pipeline_entries has the column but listPipeline is
// blind), so it does NOT belong here yet.

/** Tables whose read+write paths are verified workspace-scoped (each has a
 *  `<table>-tenancy.test.ts` pinning the WHERE workspace_id = ? filter). */
export const TENANCY_SCOPED_TABLES: ReadonlySet<string> = new Set([
  "analyses",
  "profiles",
  // Phase 1 — Library: a team's private JD drafts/openings + their edit history.
  // The recruiter LIST/edit/revert/archive paths filter by workspace_id; the
  // candidate-facing public JD page reads by slug (loadJd) as shareable content.
  // The by-slug analysis-status task writers are exempted in jds-tenancy.test.ts
  // (a JD slug is a globally-unique PK, so a by-slug flip can't cross tenants).
  "jds",
  "jd_revisions",
  // Phase 1 — a team's generated campaign packs (job-posting copy), keyed by their job.
  "campaign_packs",
  // Phase 1 — the jobs corpus + its ingest dedup. DUAL model: seeded corpus rows
  // (workspace_id NULL) are the SHARED cross-company reference every team matches
  // against; authored openings carry a team's id. Enumeration reads use
  // (workspace_id IS NULL OR = ?); by-id point reads (getJob/getJobStatus/setJobStatus)
  // are exempted in jobs-tenancy.test.ts (a job id is a globally-unique PK). The
  // job_ingests dedup PK is (content_hash, workspace_id) — dedup never crosses teams.
  "jobs",
  "job_ingests",
  // Phase 1 — a team's Decisions "group evaluations", keyed by role. Reads filter by
  // workspace_id; the upsert is workspace-guarded so a shared role_key can't clobber
  // another team's row (group-eval-tenancy.test.ts).
  "group_evals",
  // Phase 1 — the candidate pipeline (highest-PII table). Scoped across ALL files that
  // query it (pipeline.ts, analytics.ts, profiles.ts, sim-store.ts, offers-store.ts);
  // recruiter by-id reads/writes filter workspace_id so a session can't read or mutate
  // another team's entry (the IDOR the scan flagged). The two candidate-facing token
  // reads (lead_token/erasure_token) are exempted in pipeline-tenancy.test.ts. The global
  // entry-id PK is collision-safe cross-team: the DEFAULT workspace keeps `m-<key>-<job>`
  // (idempotent for existing rows) and a non-default team prefixes its workspace (P1-b).
  "pipeline_entries",
  // Phase 1 — the pipeline audit trails. Every read filters workspace_id (across
  // core.ts recordEvent, pipeline.ts, analytics.ts, sim-store.ts); recordEvent +
  // logConsentEvent auto-derive the tenant from the linked entry so the write side
  // needs no per-call-site threading (pipeline-events-tenancy.test.ts).
  "pipeline_events",
  "consent_events",
  // Phase 1 — the Channels surface. channel_webhooks (inbound lead bindings) +
  // channel_spend (per-team spend; PK widened to (channel, workspace_id)) filter on
  // workspace_id; dev_outbox (the comms outbox) auto-derives each message's tenant
  // from its referenced entry. The public receiver's token-keyed liveness counters
  // are exempt (channels-tenancy.test.ts). NOTE: the inbound receiver still files a
  // lead via intakeLead on the DEFAULT workspace — thread webhook.workspaceId through
  // the intake chain (lead-intake/cv-intake) before KP_MULTI_WORKSPACE is enabled.
  "channel_webhooks",
  "channel_spend",
  "dev_outbox",
  // Phase 1 — the Schedule surface (self-scheduling invites). The recruiter agenda +
  // invite creation + per-team slot-collision checks filter workspace_id (derived from
  // the linked entry). The candidate token flow, the reminder heartbeat's by-id ops,
  // and the global dueReminders sweep are exempt (schedule-tenancy.test.ts). NOTE: a
  // lazy-store table (own connection in schedule-store.ts) — its migration lives there,
  // not core.ts, so the boot-guard's live-table list must include it before flag enable.
  "schedule_invites",
  // Phase 1 — the Dev-case surface (devcase.ts): the recruiter enumeration reads
  // (listDevCases/listLifecycles/listPostings/listSubmissions) + every INSERT carry
  // workspace_id; child rows (postings→submissions→sessions→events) DERIVE their tenant
  // from the parent (subquery), and by-id/token point ops are exempt
  // (devcase-tenancy.test.ts).
  "dev_cases",
  "dev_lifecycle",
  "dev_postings",
  "dev_submissions",
  "dev_sessions",
  "dev_session_events",
  // Phase 1 — the onboarding hand-off (onboarding-store.ts): listTemplates/listRuns +
  // the intake-submitted set + every INSERT filter/stamp workspace_id. Templates are
  // per-team; a run derives its tenant from the Hired candidate's entry; child rows
  // (task states / intake / signatures) from their run. by-id/run_id ops and the
  // pre-boarding reminder sweep are exempt (onboarding-tenancy.test.ts).
  "onboarding_templates",
  "onboarding_runs",
  "onboarding_task_states",
  "onboarding_intake",
  "onboarding_signatures",
  // Phase 1 — rediscovery_alerts (standing silver-medalist feed): record stamps +
  // list filters workspace_id; dismiss is by-id (rediscovery-tenancy.test.ts).
  "rediscovery_alerts",
  // Phase 1 — interview_preps: one plan per pipeline entry, all ops keyed by the
  // globally-unique entry_id (can't cross tenants); the write stamps workspace_id
  // derived from the entry (interview-prep-tenancy.test.ts).
  "interview_preps",
  // Phase 1 — the candidate-facing by-token/by-key tables. Each is safe by construction
  // (every access is by an unguessable token or a globally-unique entry/submission id,
  // plus offers' global lapse/reminder heartbeat sweeps); the write stamps workspace_id
  // derived from the linked entity so a future recruiter enumeration is scopable.
  "offers", // offer letters (offers-tenancy.test.ts)
  "application_status_links", // public status link (application-status-tenancy.test.ts)
  "skill_profiles", // durable skill credentials (skill-profiles-tenancy.test.ts)
  // Phase 1 — interview_sessions (voice AI interviews): the by-job enumeration
  // (interviewedForJob) filters workspace_id + create stamps it (derived from the entry);
  // by-id/token/entry_id ops are exempt (interviews-tenancy.test.ts).
  "interview_sessions",
  // Phase 1 — tasks (background-task queue): the recruiter poll/history reads + dedup +
  // create filter/stamp workspace_id; the by-id runner ops and the `-- tenancy:global`
  // boot-recovery / readiness probes stay cross-tenant by design (tasks-tenancy.test.ts).
  // The active-dedup unique index is now (workspace_id, dedupe_key) — uq_tasks_active_dedupe_ws
  // (P1-b) — so two teams' identical dedupe_keys no longer collide at the DB level.
  "tasks",
  // Phase 1 — decision_records: the tamper-evident decision hash chain, re-architected to
  // PER-TENANT chains (org plan §6, the hard structural item). A seal links off its own
  // workspace's head hash; verify walks a single workspace's records; list filters it — so
  // one team's sealed rows never enter another's proof. Every DML query is scoped (no by-id
  // exemptions — an unscoped read would splice chains). decision-records-tenancy.test.ts.
  "decision_records",
  // Phase 2 — the curated shared JD-template library (templates-store.ts). DUAL-TIER like
  // the jobs corpus: org-shared rows (workspace_id NULL — the company library every team
  // reads) + team-private drafts (workspace_id = team). Every read/write filters on
  // (workspace_id IS NULL OR workspace_id = ?) or an explicit workspace_id, so a team
  // never sees or edits another team's private template; the org-wide default lives only
  // on org rows. No by-id exemptions (templates-tenancy.test.ts).
  "jd_templates",
  // Phase 2 — the dual-tier hiring policy (decision-config-store.ts, a lazy store). ORG-DEFAULT
  // rows (workspace_id NULL — the company baseline every team inherits: screening rules +
  // compliance jurisdiction) + TEAM OVERRIDE rows (workspace_id = team). Reads CASCADE (the
  // team's override wins, else the org default, else the code default); a write targets exactly
  // one tier. Every query filters workspace_id — no by-id exemptions (decision-config-tenancy.test.ts).
  "decision_config",
]);

/** Tables that legitimately hold NO per-tenant data: the tenant registry itself,
 *  content-addressed caches, deployment-level config, and global system/scheduler
 *  state. Kept deliberately SHORT — when in doubt a table is REQUIRED, not exempt. */
export const TENANCY_EXEMPT_TABLES: ReadonlySet<string> = new Set([
  "workspaces", // the tenant registry itself (a workspace = a team)
  // Identity foundation (P0): the ORG is the parent tenant of the workspace, so
  // these are isolated by org_id, NOT by the per-team workspace_id this manifest
  // governs — they legitimately carry no workspace_id. Their cross-org isolation
  // is enforced in their own stores (memberships/invites reads filter by
  // org_id/user_id, which is deliberately cross-workspace: a user spans teams).
  "organizations", // the org registry (parent of workspaces)
  "users",
  "user_credentials",
  "memberships",
  "invites",
  "gemini_cache", // content-hash-keyed LLM response cache (shared, not per-tenant)
  "llm_config", // deployment-level model/provider config
  "provider_keys", // deployment-level LLM provider keys, keyed by (provider, scope) —
  // the sibling of llm_config; per-org BYOM keys are a KP_MULTI_ORG concern (not per-team).
  // Billing is per-DEPLOYMENT/org, NOT per-team-workspace: one subscription + ledger for
  // the whole account (billing.ts: a single billing_state row id='workspace'), correctly
  // SHARED across an org's teams. Isolated by org (like memberships), so exempt from the
  // per-team workspace_id invariant. Multi-ORG-on-one-deployment isolation (org_id
  // filtering in these stores) is a KP_MULTI_ORG concern beyond KP_MULTI_WORKSPACE.
  "billing_state",
  "billing_events",
  "billing_credits",
  "billing_usage",
  "billing_alerts",
  // Org/deployment-level CONFIG + METERING — set once per org/deployment and shared
  // across the org's teams, so isolated by org (like billing), NOT per-team-workspace.
  // None holds per-team-private candidate data. Per-team overrides (if ever wanted) are
  // a KP_MULTI_ORG / multi-tenant enhancement, not a KP_MULTI_WORKSPACE prerequisite.
  "brand_settings", // the org's candidate-facing brand (name/accent/logo)
  "ats_config", // the org's outbound ATS webhook integration (one endpoint)
  "analytics_targets", // the org's hiring targets — "the org's recruiter hourly rate", time-to-hire goal
  "llm_usage", // deployment-level LLM metering ledger (sibling of billing_usage; written off-request from Python)
  "scheduler", // global background-job scheduler state
  "scheduler_runs",
  "scheduler_heartbeat", // one row per deployment: the clock's liveness stamp, not tenant data
  // The autonomous dev-case pipeline's CONTROL PLANE + CALIBRATION (Directions D/E,
  // dev-control.ts / dev-outcomes.ts) — deliberately "independent of the main schema".
  // The dev-case CANDIDATE data (dev_cases/lifecycle/postings/submissions/sessions/
  // session_events) is per-team and scoped above; these three are global orchestrator
  // state: ONE kill-switch + promote-floor, ONE decision log, ONE outcome-calibration
  // corpus — the sibling of `scheduler`, not per-tenant customer data.
  "dev_control", // autonomy kill-switch + promote-floor (key/value, deployment control)
  "dev_audit", // the orchestrator's immutable auto/human decision log
  "dev_outcomes", // predicted-vs-actual outcomes that calibrate the global promote-floor
  "schema_migrations",
  "_migrations",
  "sqlite_sequence", // sqlite internal
]);

/** Tables created LAZILY on a store's OWN better-sqlite3 connection (openStore), not by
 *  db/core.ts's ensureDb init — so they may be ABSENT from the live sqlite_master list at
 *  boot, when the guard runs, until their store is first touched. assertTenancyReady unions
 *  these in so it evaluates the COMPLETE declared schema regardless of which stores have run
 *  (the boot-guard "lazy-store-table hole"). Kept in lockstep with the source by
 *  tenancy-coverage.test.ts (which derives the real lazy set and asserts equality), so this
 *  can't silently drift. Membership here is about WHERE a table is created, not its tenancy
 *  class — each still appears in exactly one of SCOPED / EXEMPT above. */
export const TENANCY_LAZY_TABLES: ReadonlySet<string> = new Set([
  "application_status_links",
  "ats_config",
  "brand_settings",
  "decision_config",
  "decision_records",
  "dev_audit",
  "dev_control",
  "dev_outcomes",
  "group_evals",
  "interview_preps",
  "jd_templates",
  "job_ingests",
  "offers",
  "onboarding_intake",
  "onboarding_runs",
  "onboarding_signatures",
  "onboarding_task_states",
  "onboarding_templates",
  "rediscovery_alerts",
  "schedule_invites",
  "scheduler",
  "scheduler_runs",
]);

/** The per-tenant tables that still lack verified workspace scoping, given the full
 *  list of tables in the DB. A table is a gap unless it is verified-scoped, exempt,
 *  or a sqlite-internal table. Sorted for stable error messages / tests. */
export function tenancyGaps(
  allTables: Iterable<string>,
  scoped: ReadonlySet<string> = TENANCY_SCOPED_TABLES,
  exempt: ReadonlySet<string> = TENANCY_EXEMPT_TABLES,
): string[] {
  const gaps: string[] = [];
  for (const t of allTables) {
    if (!t || t.startsWith("sqlite_")) continue;
    if (scoped.has(t) || exempt.has(t)) continue;
    gaps.push(t);
  }
  return gaps.sort();
}

/** Boot-time fail-closed guard. When multi-workspace is enabled but the data layer
 *  is not fully scoped, REFUSE to run rather than serve cross-tenant data: an
 *  operator who flips KP_MULTI_WORKSPACE (as the docs invite) into an incompletely
 *  scoped DB gets a loud, actionable error instead of a silent PII breach. A no-op
 *  when multi-workspace is off (the default single-tenant lock is already safe). */
export function assertTenancyReady(
  allTables: Iterable<string>,
  multiWorkspace: boolean,
  lazy: ReadonlySet<string> = TENANCY_LAZY_TABLES,
): void {
  if (!multiWorkspace) return;
  // Union the lazy-store tables in: they may not exist in `allTables` (the live
  // sqlite_master list) yet at boot, so without this an unscoped lazy table would slip
  // past the guard until its store first ran — the boot-guard lazy-table hole. Now the
  // guard evaluates the complete declared schema and fails closed regardless of timing.
  const gaps = tenancyGaps(new Set([...allTables, ...lazy]));
  if (gaps.length > 0) {
    throw new Error(
      `KP_MULTI_WORKSPACE is enabled but ${gaps.length} table(s) are not workspace-scoped: ` +
        `${gaps.join(", ")}. Refusing to start to avoid a cross-tenant data leak — finish ` +
        `scoping each table's read+write paths (and add it to TENANCY_SCOPED_TABLES in ` +
        `app/_lib/tenancy.ts) or unset KP_MULTI_WORKSPACE.`,
    );
  }
}
