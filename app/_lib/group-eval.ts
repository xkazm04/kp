import Database from "better-sqlite3";
import { openStore } from "./db-path";
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
  d.exec(`
    CREATE TABLE IF NOT EXISTS group_evals (
      role_key TEXT PRIMARY KEY,
      role_title TEXT,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      workspace_id TEXT NOT NULL DEFAULT 'workspace'
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
      `INSERT INTO group_evals (role_key, role_title, payload_json, created_at, workspace_id)
       VALUES (@role_key, @role_title, @payload_json, @created_at, @workspace_id)
       ON CONFLICT(role_key) DO UPDATE SET
         role_title = excluded.role_title,
         payload_json = excluded.payload_json,
         created_at = excluded.created_at
       WHERE group_evals.workspace_id = excluded.workspace_id`
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
  try {
    return { roleKey: row.role_key, roleTitle: row.role_title, payload: JSON.parse(row.payload_json), createdAt: row.created_at };
  } catch {
    return null;
  }
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
