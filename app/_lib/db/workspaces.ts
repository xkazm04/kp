import { ensureDb } from "./core";

// Tenant root (P2). The single default workspace exists today (seeded in ensureDb);
// real multi-tenancy will add creation + per-user mapping. Shared connection.
export type Workspace = { id: string; name: string | null; createdAt: string };

function rowToWorkspace(r: Record<string, unknown>): Workspace {
  return { id: r.id as string, name: (r.name as string) ?? null, createdAt: r.created_at as string };
}

export function listWorkspaces(): Workspace[] {
  const db = ensureDb();
  return (db.prepare(`SELECT * FROM workspaces ORDER BY created_at ASC`).all() as Record<string, unknown>[]).map(rowToWorkspace);
}

export function getWorkspace(id: string): Workspace | null {
  const db = ensureDb();
  const r = db.prepare(`SELECT * FROM workspaces WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  return r ? rowToWorkspace(r) : null;
}
