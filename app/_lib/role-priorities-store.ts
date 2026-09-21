import Database from "better-sqlite3";
import { openStore } from "./db-path";
import { safeRowParse } from "./db/core";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces";
import { sanitizePriorities, type RolePriorityMap } from "./role-priorities";

// Persisted store for the role coach's PATTERN PRIORITIES — the three-level weight a
// recruiter hangs on each pattern the candidate pool shows against a role ("Kubernetes
// missing in 68% of the pool" → critical / important / minor). One row per
// (job, workspace).
//
// WHY ITS OWN TABLE rather than the job's payload_json (the seam this feature looked
// for first): the `jobs` corpus is DUAL-TIER. A seeded corpus row carries
// workspace_id NULL and is the SHARED cross-company reference every tenant matches
// against, so a priority written onto that row would be one team's private judgement
// about a role, handed to every other team on the deployment — the residual the `status`
// column already carries (see canWriteJobLifecycle) and not one worth widening. Keying
// on (job_id, workspace_id) keeps a corpus role taggable by every team WITHOUT any of
// them seeing each other's weighting.
//
// Uses its OWN better-sqlite3 connection on the shared DB file (WAL allows this), the
// same lazy-store shape as group-eval.ts / offers-store.ts, so it never touches the
// fork-churned db.ts. Listed in TENANCY_LAZY_TABLES + TENANCY_SCOPED_TABLES; every
// statement below binds workspace_id (role-priorities-tenancy.test.ts pins that).

let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  const d = openStore();
  d.exec(`
    CREATE TABLE IF NOT EXISTS role_pattern_priorities (
      job_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL DEFAULT 'workspace',
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (job_id, workspace_id)
    );
  `);
  _db = d;
  return d;
}

/** This team's priorities for one role. An absent row (and a corrupt payload, which
 *  safeRowParse logs) reads as "nothing tagged yet" — the panel's honest default. */
export function getRolePriorities(jobId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): RolePriorityMap {
  const row = db()
    .prepare(`SELECT payload_json FROM role_pattern_priorities WHERE job_id = ? AND workspace_id = ?`)
    .get(jobId, workspaceId) as { payload_json: string } | undefined;
  if (!row) return {};
  const parsed = safeRowParse<unknown>(row.payload_json, "getRolePriorities", jobId);
  return sanitizePriorities(parsed);
}

/** Replace this team's priorities for one role. The panel owns the whole map (a tag
 *  change re-sends every entry), so this is a REPLACE rather than a merge — an
 *  untagged pattern must be able to go back to untagged. Returns what was stored. */
export function setRolePriorities(
  jobId: string,
  priorities: unknown,
  workspaceId: string = DEFAULT_WORKSPACE_ID,
): RolePriorityMap {
  const clean = sanitizePriorities(priorities);
  const now = new Date().toISOString();
  if (Object.keys(clean).length === 0) {
    // An empty map is a DELETE, not a row of `{}`: "this team never tagged this role"
    // and "this team cleared every tag" are the same fact to every reader.
    db().prepare(`DELETE FROM role_pattern_priorities WHERE job_id = ? AND workspace_id = ?`).run(jobId, workspaceId);
    return clean;
  }
  db()
    .prepare(
      `INSERT INTO role_pattern_priorities (job_id, workspace_id, payload_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(job_id, workspace_id) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at`,
    )
    .run(jobId, workspaceId, JSON.stringify(clean), now);
  return clean;
}
