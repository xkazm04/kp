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

/** Tables whose read+write paths are verified workspace-scoped: each is pinned by a
 *  query-level guard — normally a colocated `<table>-tenancy.test.ts`, and for the five
 *  stores that never got one (candidate_nps, outreach_state, ats_links,
 *  calendar_connections, apply_sessions) an equivalent pin inside
 *  tenancy-coverage.test.ts. That file now ENFORCES the rule: a table cannot be added
 *  to this list without a proof, because "verified" used to be a claim nothing checked
 *  and those five carried it on nothing at all.
 *
 *  What a pin does NOT settle is which point-ops each guard exempts. Every guard writes
 *  its own by-id / by-token carve-out, and a carve-out is only as good as its reason:
 *  a candidate capability token or a read of a globally-unique PK is safe, a STICKY
 *  recruiter-visible WRITE is not. Say which one applies in the entry below. */
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
  // D5 — the dev-studio outcome/calibration corpus (dev-outcomes.ts). Reclassified from
  // EXEMPT: it holds per-team hiring ground truth (who a team hired/rejected and how they
  // performed), and the promote-floor recommendation a recruiter acts on is computed from
  // it — pooling teams meant one team's floor advice came from another team's hires. Every
  // read/write filters workspace_id; the pipeline auto-record derives the tenant from the
  // submission the ref names (dev-outcomes-tenancy.test.ts).
  "dev_outcomes",
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
  // W0.6b — candidate NPS captured on the public status page. Scoped because it feeds a
  // team's metric pack: pooling it would let one team's candidate-experience number be
  // computed from another team's rejections. Every read/write in candidate-nps-store.ts
  // filters workspace_id, and the recruiter-side summary reads the caller's workspace.
  // The PUBLIC write (/api/status/[token]/nps) derives its tenant with
  // getEntryWorkspace(entryId) — the same rule the sibling /decisions route uses —
  // so a second team's candidate feedback lands in THEIR pack. (It used to fall
  // through to the default workspace, which also 404'd their status page.)
  "candidate_nps",
  // Recruiter feedback door (feedback-store.ts): in-product "Send feedback"
  // submissions. Scoped because a message can name a team's candidates/roles and
  // feeds that team's operator view on /control: every read/write in
  // feedback-store.ts filters/stamps workspace_id (feedback-tenancy.test.ts).
  "feedback",
  // W2.3 — per-entry outreach memory (sends / replied / manually halted). Scoped because
  // it decides whether a real message goes to a real person: a cross-tenant read would
  // either re-mail someone who already replied to another team, or silence a sequence
  // that team never ran. Every read/write in outreach-state-store.ts filters
  // workspace_id, and the inbound receiver passes the webhook's own workspace — this one
  // is NOT subject to the default-workspace caveat above.
  "outreach_state",
  // W1.1 — the ATS external-id link table. Scoped because it decides WHICH kp entry a
  // vendor application maps to: a cross-tenant read would either attach another team's
  // candidate to this team's pipeline, or fail to recognise an import and duplicate it.
  // The PK carries workspace_id so two tenants can connect the same ATS account without
  // colliding on the vendor's ids.
  "ats_links",
  // W1.4 — the connected Google calendar per team (calendar-connections). Scoped because
  // it holds a refresh token to a real person's calendar and decides which calendar's
  // free/busy filters a team's offered interview slots: pooling it would leak one team's
  // availability into another's booking page. PK is (workspace_id, provider) and every
  // read/write in calendar/token-store.ts filters workspace_id. Lazy-store table (own
  // connection), hence also listed in TENANCY_LAZY_TABLES.
  "calendar_connections",
  // Phase 1 — the Channels surface. channel_webhooks (inbound lead bindings) +
  // channel_spend (per-team spend; PK widened to (channel, workspace_id)) filter on
  // workspace_id; dev_outbox (the comms outbox) auto-derives each message's tenant
  // from its referenced entry. The public receiver's token-keyed liveness counters
  // are exempt (channels-tenancy.test.ts). The inbound receiver files each lead into
  // the team that minted the webhook (`webhook.workspaceId` threaded through
  // lead-intake/cv-intake, which also falls back to the opening's own workspace).
  "channel_webhooks",
  "channel_spend",
  "dev_outbox",
  // Phase 1 — recruiter-set analytics goals (analytics.ts: setAnalyticsTarget/
  // listAnalyticsTargets). PK widened to (metric, workspace_id) so each team keeps its
  // own funnel-conversion goals, time-to-hire goal, and recruiter_hourly_czk ROI rate;
  // every read/write filters workspace_id (analytics-targets-tenancy.test.ts).
  "analytics_targets",
  // Phase 1 — the Schedule surface (self-scheduling invites). The recruiter agenda +
  // invite creation + per-team slot-collision checks filter workspace_id (derived from
  // the linked entry). The candidate token flow, the reminder heartbeat's by-id ops,
  // and the global dueReminders sweep are exempt (schedule-tenancy.test.ts). A
  // lazy-store table (own connection in schedule-store.ts) — its migration lives there,
  // not core.ts, so it is also listed in TENANCY_LAZY_TABLES, which assertTenancyReady
  // unions in so the boot guard sees it whether or not the store has run yet.
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
  // Captured prompt channel (LLM-era controls #2): chat rows inherit their
  // session's workspace at INSERT (appendDevSessionChat); by-session reads are
  // exempt like the sibling event log.
  "dev_session_chat",
  // Phase 1 — rediscovery_alerts (standing silver-medalist feed): record stamps, and
  // list + dismiss BOTH filter workspace_id. NO by-id exemption — the note here used to
  // grant one ("dismiss is by-id"), and that carve-out is exactly what shipped a
  // cross-tenant write: an alert id is handed to every recruiter by
  // listRediscoveryAlerts and dismissal is sticky, so a by-id write is not
  // self-authorizing the way a candidate capability token is. rediscovery-tenancy.test.ts
  // now carries a literal per-statement exemption allowlist, currently empty.
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
  // The apply funnel's start rows (apply-session-store.ts). Minted from the public
  // apply surface, so workspace_id is derived from the OPENING (getJobWorkspace) —
  // the same rule the submit routes file the resulting entry under. The rate read
  // filters workspace_id; the back-link write is by the session's own
  // client-generated PK, which carries no tenant meaning and grants nothing.
  "apply_sessions",
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
  // Role-intake dialogs (db/intakes.ts, docs/concepts/role-intake-dialog.md):
  // operator-internal, no public token, so EVERY query — point reads included —
  // filters/stamps workspace_id; a leaked intake id never resolves across
  // tenants (intakes-tenancy.test.ts).
  "role_intakes",
  // Phase 2 — the curated shared JD-template library (templates-store.ts). DUAL-TIER like
  // the jobs corpus: org-shared rows (workspace_id NULL — the company library every team
  // reads) + team-private drafts (workspace_id = team). Every read/write filters on
  // (workspace_id IS NULL OR workspace_id = ?) or an explicit workspace_id, so a team
  // never sees or edits another team's private template; the org-wide default lives only
  // on org rows. No by-id exemptions (templates-tenancy.test.ts).
  "jd_templates",
  // Agent-candidate bridge (db/agents.ts): the per-team job→AgentFitSpec artifacts,
  // the hired-agent roster (spec + budget + the report capability token) and the
  // inbound cost/activity ledger. Every recruiter-facing read/write filters
  // workspace_id; the PUBLIC report route's by-report-token lookup is the one
  // exemption (the CSPRNG token is the capability — channel_webhooks doctrine),
  // and the resolved row supplies the workspace all its writes scope to
  // (agents-tenancy.test.ts).
  "agent_fit_specs",
  "hired_agents",
  "agent_activity",
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
  // Billing is per-ORG, NOT per-team-workspace: one subscription + ledger per customer
  // company, correctly SHARED across an org's teams — so these stay EXEMPT from the
  // per-team workspace_id invariant this manifest governs. Since org-plan Phase 3
  // (data layer) the org isolation is REAL, not just doctrine: every table carries
  // org_id, billing.ts keys every read/write on it (billingOrgForWorkspace maps a
  // team seam to its org; the webhook attributes via checkout metadata → stored
  // subscription/customer → default org), and billing-tenancy.test.ts pins the
  // org_id filters + cross-org isolation the way *-tenancy tests pin workspace_id.
  // Two documented deployment-global exceptions, asserted in that same test:
  // billing_events dedupes on the provider's GLOBAL event id (org_id is
  // attribution only) and listBillingAlerts is the operator's cross-customer
  // worklist (each row still carries its orgId).
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
  "ats_delivery", // the ATS webhook delivery ledger (sibling of ats_config; deployment/org-level, not per-tenant)
  // W1.1 — the INBOUND sibling of ats_config: per-provider base URL, encrypted API token
  // and field map. Org-level for the same reason as its egress twin — an ATS account is
  // connected once for the company, not per hiring team. It holds no candidate data; the
  // per-candidate rows it produces land in ats_links, which IS workspace-scoped.
  "ats_connections",
  "comms_relay_config", // the org's outbound comms delivery relay (one endpoint; sibling of ats_config)
  // The local half of the edge pairing (edge-config.ts, docs/concepts/local-first-edge.md):
  // where the edge lives, the shared HMAC secret, this INSTALL's sealing keypair and the
  // drain cursor. Its own header says it is "modeled on comms-relay-store.ts down to the
  // details", and it is exempt for the same reason as that sibling: a literal singleton
  // (`CHECK (id = 1)`) of deployment-level integration config and secrets, paired once per
  // install and holding no candidate data. The per-tenant rows the drain produces land in
  // the tables scoped above. Lazy-store table (own openStore connection), hence also in
  // TENANCY_LAZY_TABLES; and a singleton with no org_id, hence ORG_CONFIG_NOT_PORTABLE.
  "edge_config",
  // Agent-candidate bridge config (agent-hire/bridge-store.ts): the Personas desktop
  // app's base URL + encrypted pk_ API key + paired flag — deployment-level
  // integration config exactly like ats_connections (connected once for the
  // company, holds no candidate data; the per-tenant rows it produces land in
  // hired_agents/agent_activity, which ARE workspace-scoped).
  "personas_bridge",
  "login_attempts", // brute-force throttle counters keyed by email/IP — deployment-global, no tenant dimension
  "llm_usage", // deployment-level LLM metering ledger (sibling of billing_usage; written off-request from Python)
  "scheduler", // global background-job scheduler state (ONE clock; its toggle's blast radius is the whole installation — operator-gated, see scheduler-store.ts)
  // One row per global sweep. Exempt as a ROW, not as a payload: its decisions_json
  // holds per-entry rows across every team, each stamped with the entry's workspaceId
  // and filtered to the caller's tenant on read (scheduler-store.decisionsForWorkspace).
  "scheduler_runs",
  "scheduler_heartbeat", // one row per deployment: the clock's liveness stamp, not tenant data
  // The autonomous dev-case pipeline's CONTROL PLANE (Direction D, dev-control.ts) —
  // deliberately "independent of the main schema". The dev-case CANDIDATE data
  // (dev_cases/lifecycle/postings/submissions/sessions/session_events) is per-team and
  // scoped above, as is dev_outcomes since D5; these two remain global orchestrator
  // state: ONE kill-switch + promote-floor and ONE decision log — the sibling of
  // `scheduler`, not per-tenant customer data.
  "dev_control", // autonomy kill-switch + promote-floor (key/value, deployment control)
  "dev_audit", // the orchestrator's immutable auto/human decision log
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
  "apply_sessions",
  "ats_config",
  "ats_connections",
  "ats_delivery",
  "brand_settings",
  "calendar_connections",
  "comms_relay_config",
  "decision_config",
  "decision_records",
  "dev_audit",
  "dev_control",
  "dev_outcomes",
  "edge_config",
  "group_evals",
  "interview_preps",
  "jd_templates",
  "job_ingests",
  "login_attempts",
  "offers",
  "personas_bridge",
  "rediscovery_alerts",
  "schedule_invites",
  "scheduler",
  "scheduler_runs",
]);

/** RETIRED tables: rows a PREVIOUS version of kp wrote and no current code path
 *  creates, reads or writes. The post-hire onboarding module was removed (kp is a
 *  hiring studio; the hand-off after Hired belongs to the HRIS the ATS webhook
 *  feeds) WITHOUT a drop migration, so a database created before that removal still
 *  carries these five tables and their rows. sqlite_master therefore still reports
 *  them, and the boot guard would count each as an unscoped gap and refuse to start.
 *
 *  This is deliberately its OWN category rather than a quiet addition to
 *  TENANCY_EXEMPT_TABLES: exempt means "genuinely global, and that is correct".
 *  These are neither global nor correct — they are inert. A table no code queries
 *  cannot leak across tenants, which is why it is safe to pass the guard; but it is
 *  also not something to hold up as verified, which is why it does not go back in
 *  TENANCY_SCOPED_TABLES (its colocated proof, onboarding-tenancy.test.ts, is gone
 *  with the feature). If a future table name is reused, remove it from here first —
 *  a live table hiding behind a retirement note is exactly the silent hole the
 *  manifest exists to prevent. */
export const TENANCY_RETIRED_TABLES: ReadonlySet<string> = new Set([
  "onboarding_intake",
  "onboarding_runs",
  "onboarding_signatures",
  "onboarding_task_states",
  "onboarding_templates",
]);

/** The per-tenant tables that still lack verified workspace scoping, given the full
 *  list of tables in the DB. A table is a gap unless it is verified-scoped, exempt,
 *  retired, or a sqlite-internal table. Sorted for stable error messages / tests. */
export function tenancyGaps(
  allTables: Iterable<string>,
  scoped: ReadonlySet<string> = TENANCY_SCOPED_TABLES,
  exempt: ReadonlySet<string> = TENANCY_EXEMPT_TABLES,
  retired: ReadonlySet<string> = TENANCY_RETIRED_TABLES,
): string[] {
  const gaps: string[] = [];
  for (const t of allTables) {
    if (!t || t.startsWith("sqlite_")) continue;
    if (scoped.has(t) || exempt.has(t) || retired.has(t)) continue;
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

// ---- Org-scoped backup manifest --------------------------------------------
//
// The whole-database dump could not survive multi-tenancy: it enumerated
// `sqlite_master` and did `SELECT * FROM <table>` with no predicate, so one team's
// "Download backup" handed them every other tenant's candidates — and both routes
// had to be refused outright once KP_MULTI_WORKSPACE went on.
//
// The replacement backs up ONE ORGANIZATION, and it is driven by THIS MANIFEST
// rather than by sqlite_master. That is the point: a table nobody classified is a
// table nobody decided about, and enumerating the live schema silently swept up
// retired tables, deployment secrets and the shared corpus. Here an unclassified
// table fails `tenancy-coverage.test.ts` instead.
//
// Defaults do the bulk of the work, so only genuine exceptions are hand-listed:
// every TENANCY_SCOPED_TABLES member is "workspace", every TENANCY_EXEMPT_TABLES
// member is "exclude", and ORG_EXPORT_OVERRIDES names the rest.

export type OrgExportClass =
  /** `WHERE workspace_id IN (the org's workspaces)`. Also the right rule for the
   *  dual-tier `jobs` table, whose NULL rows are the SHARED cross-company corpus —
   *  deployment reference data, identical everywhere, not the org's property. */
  | "workspace"
  /** `WHERE org_id = ?`. */
  | "org"
  /** `WHERE workspace_id IS NULL OR workspace_id IN (...)`. The opposite reading of
   *  NULL from `jobs`: here the null tier is the ORG's own shared layer (its curated
   *  template library, its compliance jurisdiction and screening baseline), so a
   *  backup that dropped it would silently reset the org to code defaults. */
  | "org_shared"
  /** `WHERE user_id IN (the org's users)` — a child with no tenant column. */
  | "by_user"
  /** The union of both arms: a membership is the only place a role lives, and a
   *  user of this org may hold one on another org's team (nothing forbids it), so
   *  either arm alone silently strips somebody's access. */
  | "membership"
  /** Not the org's to carry: deployment config and secrets, provider-global
   *  ledgers, caches, runner state, retired tables. */
  | "exclude";

export const ORG_EXPORT_OVERRIDES: ReadonlyMap<string, OrgExportClass> = new Map<string, OrgExportClass>([
  // Identity — the minimum that makes a restored org coherent. Without
  // user_credentials nobody can log in; without memberships nobody has a role.
  ["organizations", "org"],
  ["workspaces", "org"],
  ["users", "org"],
  ["user_credentials", "by_user"],
  ["memberships", "membership"],
  ["invites", "org"],

  // Billing is org-keyed and belongs to the org's record.
  ["billing_state", "org"],
  ["billing_credits", "org"],
  ["billing_usage", "org"],
  ["billing_alerts", "org"],
  // …except the webhook dedup ledger: its PK is the PROVIDER's globally-unique
  // event id (org_id is attribution only), so it is not org data and its keys
  // collide by construction.
  ["billing_events", "exclude"],

  // The two genuinely org-shared null tiers (see "org_shared" above).
  ["jd_templates", "org_shared"],
  ["decision_config", "org_shared"],

  // Runner state, not org data — and already the whole-DB dump's documented skip.
  ["tasks", "exclude"],
]);

/** The export class for one table. Unknown ⇒ null, which the coverage test turns
 *  into a build failure rather than a silent omission. */
export function orgExportClass(
  table: string,
  scoped: ReadonlySet<string> = TENANCY_SCOPED_TABLES,
  exempt: ReadonlySet<string> = TENANCY_EXEMPT_TABLES,
  retired: ReadonlySet<string> = TENANCY_RETIRED_TABLES,
): OrgExportClass | null {
  const override = ORG_EXPORT_OVERRIDES.get(table);
  if (override) return override;
  if (retired.has(table)) return "exclude";
  if (scoped.has(table)) return "workspace";
  if (exempt.has(table)) return "exclude";
  return null;
}

/** The tables tenancy.ts calls "org-level" that carry NO org_id — they are literal
 *  singletons (`CHECK (id = 1)`, a fixed ROW_ID, or a provider PK). A backup cannot
 *  say which org owns them, so an org restore leaves them alone and the org
 *  re-enters its integration settings. Re-keying them by org is the prerequisite
 *  for carrying them, and is tracked in docs/features/organization/README.md.
 *
 *  This is the list the restore SUMMARY reads out, so a new singleton config table
 *  that is merely excluded — and not named here — restores as a silent blank the
 *  operator is never told to re-enter. */
export const ORG_CONFIG_NOT_PORTABLE: ReadonlySet<string> = new Set([
  "brand_settings",
  "ats_config",
  "ats_connections",
  "ats_delivery",
  "comms_relay_config",
  "personas_bridge",
  "edge_config", // the edge pairing: URL + HMAC secret + this install's sealing keypair
]);
