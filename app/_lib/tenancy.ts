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
  "scheduler", // global background-job scheduler state
  "scheduler_runs",
  "schema_migrations",
  "_migrations",
  "sqlite_sequence", // sqlite internal
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
export function assertTenancyReady(allTables: Iterable<string>, multiWorkspace: boolean): void {
  if (!multiWorkspace) return;
  const gaps = tenancyGaps(allTables);
  if (gaps.length > 0) {
    throw new Error(
      `KP_MULTI_WORKSPACE is enabled but ${gaps.length} table(s) are not workspace-scoped: ` +
        `${gaps.join(", ")}. Refusing to start to avoid a cross-tenant data leak — finish ` +
        `scoping each table's read+write paths (and add it to TENANCY_SCOPED_TABLES in ` +
        `app/_lib/tenancy.ts) or unset KP_MULTI_WORKSPACE.`,
    );
  }
}
