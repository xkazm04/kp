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
  _db = d;
  return d;
}

export type GroupEval = {
  roleKey: string;
  roleTitle: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};

export function saveGroupEval(
  roleKey: string,
  roleTitle: string | null,
  payload: Record<string, unknown>,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): void {
  db()
    .prepare(
      // Upsert on the composite identity (role_key, workspace_id): a re-run replaces
      // THIS team's eval for the role, and two teams sharing a roleKey each keep their
      // own row. (The old ON CONFLICT(role_key) + workspace_id WHERE guard silently
      // dropped the second tenant's write — see the composite-PK note in db().)
      `INSERT INTO group_evals (role_key, role_title, payload_json, created_at, workspace_id)
       VALUES (@role_key, @role_title, @payload_json, @created_at, @workspace_id)
       ON CONFLICT(role_key, workspace_id) DO UPDATE SET
         role_title = excluded.role_title,
         payload_json = excluded.payload_json,
         created_at = excluded.created_at`
    )
    .run({
      role_key: roleKey,
      role_title: roleTitle,
      payload_json: JSON.stringify(payload),
      created_at: new Date().toISOString(),
      workspace_id: workspaceId,
    });
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
