import Database from "better-sqlite3";
import { openStore } from "./db-path";
import { safeRowParse } from "./db/core";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces";

// Persisted store for Decisions "group evaluations" — one comparative evaluation
// per role, regenerated on demand and read back into the modal. Uses its OWN
// better-sqlite3 connection to the shared DB file (WAL allows this) so it never
// touches the fork-churned db.ts, mirroring dev-control.ts / dev-outcomes.ts.

let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  // Isolated connection on the shared kp.sqlite file (WAL + busy_timeout=5000):
  // shares kp.sqlite with db.ts / offers-store; without the wait a concurrent
  // writer can make a saveGroupEval write throw SQLITE_BUSY instantly. Wait
  // briefly instead of crashing (mirrors offers-store's documented fix).
  const d = openStore();
  // The identity of an eval is (role_key, workspace_id): roleKey is jobId ?? jobTitle
  // ?? "unassigned" (DecisionsTab.roleKeyOf), so jobId-less roles collide across
  // tenants ("unassigned" is a guaranteed collision; a shared jobTitle a likely one).
  // A SOLE role_key PRIMARY KEY (the original schema) let only ONE tenant ever hold an
  // eval per roleKey — the second team's INSERT hit ON CONFLICT(role_key) and was
  // dropped by the workspace_id guard, so its eval never persisted and every open
  // re-fired a PAID LLM run. The composite key is the store half of group-eval-read-
  // tenancy (the route read-threading is the other half).
  d.exec(`
    CREATE TABLE IF NOT EXISTS group_evals (
      role_key TEXT NOT NULL,
      role_title TEXT,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      workspace_id TEXT NOT NULL DEFAULT 'workspace',
      PRIMARY KEY (role_key, workspace_id)
    );
  `);
  // Tenancy scoping (E0 Phase 1) — backfill workspace_id on a pre-existing table.
  // Isolated stores have no core.ts migrator, so add the column here, tolerating the
  // "duplicate column" error when it's already present (mirrors the migrateExec guard).
  try {
    d.exec(`ALTER TABLE group_evals ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'workspace'`);
  } catch {
    /* column already exists — idempotent */
  }
  // Rebuild a legacy table whose PRIMARY KEY is role_key ALONE into the composite
  // (role_key, workspace_id). Detect via PRAGMA: workspace_id has pk=0 on the old
  // schema. Idempotent — the freshly-created table above already has the composite key,
  // so the rebuild only runs for a DB created before this migration. Any legacy row keeps
  // its (role_key, workspace_id) pair; if a real cross-tenant collision on role_key had
  // already dropped one team's row, only the surviving row exists to carry over.
  try {
    const cols = d.prepare(`PRAGMA table_info(group_evals)`).all() as { name: string; pk: number }[];
    const wsCol = cols.find((c) => c.name === "workspace_id");
    if (wsCol && wsCol.pk === 0) {
      d.exec(`
        BEGIN;
        CREATE TABLE group_evals_v2 (
          role_key TEXT NOT NULL,
          role_title TEXT,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          workspace_id TEXT NOT NULL DEFAULT 'workspace',
          PRIMARY KEY (role_key, workspace_id)
        );
        INSERT OR IGNORE INTO group_evals_v2 (role_key, role_title, payload_json, created_at, workspace_id)
          SELECT role_key, role_title, payload_json, created_at, workspace_id FROM group_evals;
        DROP TABLE group_evals;
        ALTER TABLE group_evals_v2 RENAME TO group_evals;
        COMMIT;
      `);
    }
  } catch {
    /* rebuild raced/failed — the composite CREATE above still governs a fresh table */
  }
  // The cohort a stored eval was computed against (candidateSetFingerprint of the
  // role's cohort at run time). NULL on every row written before this column existed
  // — a legacy row is adopted by the first CAS write that expected `null`, never
  // permanently locked. Same duplicate-column guard as workspace_id above.
  try {
    d.exec(`ALTER TABLE group_evals ADD COLUMN cohort_hash TEXT`);
  } catch {
    /* column already exists — idempotent */
  }
  _db = d;
  return d;
}

export type GroupEval = {
  roleKey: string;
  roleTitle: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};

/** What a caller observed about a role's stored eval BEFORE it started computing —
 *  the precondition a CAS write re-asserts. `exists: false` means "there was no row
 *  for this key"; `cohortHash: null` on an existing row means a legacy row written
 *  before the column existed (adoptable, not locked). */
export type GroupEvalCohortState = { exists: boolean; cohortHash: string | null };

/** Read the CAS precondition for a key. Deliberately separate from getGroupEval:
 *  the callers that need this need only the two fields, and adding them to
 *  `GroupEval` would push a persistence detail onto every payload reader. */
export function readGroupEvalCohortState(
  roleKey: string,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): GroupEvalCohortState {
  const row = db()
    .prepare(`SELECT cohort_hash FROM group_evals WHERE role_key = ? AND workspace_id = ?`)
    .get(roleKey, workspaceId) as { cohort_hash: string | null } | undefined;
  return row ? { exists: true, cohortHash: row.cohort_hash ?? null } : { exists: false, cohortHash: null };
}

/**
 * Persist one evaluation. Returns whether the write actually landed.
 *
 * A group-eval run is a read→compute→write that CANNOT hold a transaction: the
 * compute spawns up to eight Python processes and takes minutes, and an `await`
 * inside `db.transaction()` silently forfeits atomicity (the house rule). So the
 * write re-asserts what the read saw, exactly like `actOnPipelineEntry`'s
 * `expectedStage` — here keyed on the cohort the run actually ranked.
 *
 * Without `cas` this is the historical unconditional upsert, kept for callers that
 * genuinely have no prior observation (tests, scripts, and the invalidation-driven
 * paths that are not racing anybody).
 *
 * With `cas` the write lands only if the row is still in the state the run started
 * from — no row then, still no row now; or the same `cohortHash` it read. Otherwise
 * a newer evaluation is already there and OURS is the stale one: it is dropped, and
 * `false` is returned so the caller can log which result it discarded and why. That
 * is the case the dedupe key narrows but cannot close, because a run that started
 * before a pipeline write still finishes after it.
 */
export function saveGroupEval(
  roleKey: string,
  roleTitle: string | null,
  payload: Record<string, unknown>,
  workspaceId: string = DEFAULT_WORKSPACE_ID,
  cas?: { cohortHash: string; expected: GroupEvalCohortState }
): boolean {
  const row = {
    role_key: roleKey,
    role_title: roleTitle,
    payload_json: JSON.stringify(payload),
    created_at: new Date().toISOString(),
    workspace_id: workspaceId,
    cohort_hash: cas?.cohortHash ?? null,
  };
  if (!cas) {
    // Upsert on the composite identity (role_key, workspace_id): a re-run replaces
    // THIS team's eval for the role, and two teams sharing a roleKey each keep their
    // own row. (The old ON CONFLICT(role_key) + workspace_id WHERE guard silently
    // dropped the second tenant's write — see the composite-PK note in db().)
    db()
      .prepare(
        `INSERT INTO group_evals (role_key, role_title, payload_json, created_at, workspace_id, cohort_hash)
         VALUES (@role_key, @role_title, @payload_json, @created_at, @workspace_id, @cohort_hash)
         ON CONFLICT(role_key, workspace_id) DO UPDATE SET
           role_title = excluded.role_title,
           payload_json = excluded.payload_json,
           created_at = excluded.created_at,
           cohort_hash = excluded.cohort_hash`
      )
      .run(row);
    return true;
  }
  if (!cas.expected.exists) {
    // The run saw NO eval for this key. If one appeared while it computed, that run
    // is newer than ours by construction — DO NOTHING and report the drop.
    const res = db()
      .prepare(
        `INSERT INTO group_evals (role_key, role_title, payload_json, created_at, workspace_id, cohort_hash)
         VALUES (@role_key, @role_title, @payload_json, @created_at, @workspace_id, @cohort_hash)
         ON CONFLICT(role_key, workspace_id) DO NOTHING`
      )
      .run(row);
    return res.changes > 0;
  }
  // The run saw a row carrying `expected.cohortHash`. `IS` (not `=`) so a legacy
  // row's NULL compares equal to the null the caller read from it, instead of the
  // three-valued `NULL = NULL` that would make every pre-column row unwritable.
  // A row that vanished under us (an invalidation) is NOT re-created here: no rows
  // match, changes === 0, and the stale result is dropped rather than resurrected.
  const res = db()
    .prepare(
      `UPDATE group_evals
          SET role_title = @role_title,
              payload_json = @payload_json,
              created_at = @created_at,
              cohort_hash = @cohort_hash
        WHERE role_key = @role_key
          AND workspace_id = @workspace_id
          AND cohort_hash IS @expected_cohort_hash`
    )
    .run({ ...row, expected_cohort_hash: cas.expected.cohortHash });
  return res.changes > 0;
}

export function getGroupEval(roleKey: string, workspaceId: string = DEFAULT_WORKSPACE_ID): GroupEval | null {
  const row = db()
    .prepare(`SELECT role_key, role_title, payload_json, created_at FROM group_evals WHERE role_key = ? AND workspace_id = ?`)
    .get(roleKey, workspaceId) as { role_key: string; role_title: string | null; payload_json: string; created_at: string } | undefined;
  if (!row) return null;
  // Decode at the shared seam (safeRowParse): a corrupt payload still reads as "no
  // eval", but the corruption is recorded in the row-health ledger, not swallowed.
  const payload = safeRowParse<Record<string, unknown>>(row.payload_json, "getGroupEval.payload", roleKey);
  if (payload === null) return null;
  return { roleKey: row.role_key, roleTitle: row.role_title, payload, createdAt: row.created_at };
}

/** Which of the given role keys already have a saved evaluation (for this team). */
export function listEvaluatedRoles(roleKeys: string[], workspaceId: string = DEFAULT_WORKSPACE_ID): Record<string, string> {
  if (roleKeys.length === 0) return {};
  const placeholders = roleKeys.map(() => "?").join(",");
  const rows = db()
    .prepare(`SELECT role_key, created_at FROM group_evals WHERE role_key IN (${placeholders}) AND workspace_id = ?`)
    .all(...roleKeys, workspaceId) as { role_key: string; created_at: string }[];
  return Object.fromEntries(rows.map((r) => [r.role_key, r.created_at]));
}

/**
 * Expire every cached evaluation for one role in one workspace — the role's top-N
 * row and every `<roleKey>#sel:<n>-<hash>` selection row — and return how many rows
 * were dropped.
 *
 * The eval cache had no TTL and no invalidation of any kind, and a SELECTION key is
 * stable across pipeline writes BY CONSTRUCTION: the same four entry ids hash to the
 * same key however far those candidates have since moved. So a recruiter who
 * rejected two of the four and reopened the identical selection was served the
 * cached comparison — a lead crowned over a field that no longer existed. The
 * modal's pool-drift diff (`evaluatedLabels` against the live pending entries) only
 * DISCLOSES that; it never expires the row, and a disclosure the reader has to
 * notice is not a cache policy.
 *
 * Deleting rather than TTL-ing is deliberate: a cohort that moved makes the stored
 * comparison wrong immediately, not in an hour, and the next open simply re-runs.
 * Governance stickiness reads the role-level row too (resolveGovernanceMode), so an
 * invalidated role falls back to the REQUESTED mode — the same state a role that has
 * never been evaluated is in, and the mode is re-persisted by the re-run.
 *
 * The LIKE pattern is ESCAPEd: `roleKeyOf` falls back to the job TITLE, which is free
 * text, so "Data % Analyst" or "senior_dev" are legal role keys and an unescaped
 * pattern built from one would match half the table.
 */
export function invalidateGroupEvalSelection(roleKey: string, workspaceId: string = DEFAULT_WORKSPACE_ID): number {
  const key = (roleKey ?? "").trim();
  if (!key) return 0;
  const prefix = `${key.replace(/[\\%_]/g, (c) => `\\${c}`)}#sel:`;
  const res = db()
    .prepare(
      `DELETE FROM group_evals
        WHERE workspace_id = ?
          AND (role_key = ? OR role_key LIKE ? ESCAPE '\\')`
    )
    .run(workspaceId, key, `${prefix}%`);
  return res.changes;
}
