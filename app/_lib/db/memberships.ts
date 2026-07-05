import { ensureDb } from "./core";
import { randomId } from "../random-id";
import type { MemberRole } from "../auth/roles";

// Memberships (P0) — a user's link to ONE team (workspace) with a role. Many-to-
// many by design (a recruiter can span several teams of the same org); the
// UNIQUE(user_id, workspace_id) index makes upsert one-role-per-user-per-team.
// The server gate resolves roleForUserInWorkspace() then asks roleCan(role, cap).

export type Membership = {
  id: string;
  userId: string;
  workspaceId: string;
  role: MemberRole;
  createdAt: string;
};

function rowToMembership(r: Record<string, unknown>): Membership {
  return {
    id: r.id as string,
    userId: r.user_id as string,
    workspaceId: r.workspace_id as string,
    role: r.role as MemberRole,
    createdAt: r.created_at as string,
  };
}

export function getMembership(userId: string, workspaceId: string): Membership | null {
  const db = ensureDb();
  const r = db.prepare(`SELECT * FROM memberships WHERE user_id = ? AND workspace_id = ?`).get(userId, workspaceId) as
    | Record<string, unknown>
    | undefined;
  return r ? rowToMembership(r) : null;
}

/** Add or update a user's role on a team (idempotent per (user, workspace)). */
export function upsertMembership(userId: string, workspaceId: string, role: MemberRole): Membership {
  const db = ensureDb();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO memberships (id, user_id, workspace_id, role, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, workspace_id) DO UPDATE SET role = excluded.role`,
  ).run(randomId("mem"), userId, workspaceId, role, createdAt);
  // Re-read so the returned row reflects the surviving id/created_at on conflict.
  return getMembership(userId, workspaceId)!;
}

/** Every team the user belongs to (across their org). */
export function listMembershipsForUser(userId: string): Membership[] {
  const db = ensureDb();
  return (db.prepare(`SELECT * FROM memberships WHERE user_id = ? ORDER BY created_at ASC`).all(userId) as Record<string, unknown>[]).map(
    rowToMembership,
  );
}

/** Every member of a team. */
export function listMembershipsForWorkspace(workspaceId: string): Membership[] {
  const db = ensureDb();
  return (
    db.prepare(`SELECT * FROM memberships WHERE workspace_id = ? ORDER BY created_at ASC`).all(workspaceId) as Record<string, unknown>[]
  ).map(rowToMembership);
}

export function removeMembership(userId: string, workspaceId: string): boolean {
  const db = ensureDb();
  const info = db.prepare(`DELETE FROM memberships WHERE user_id = ? AND workspace_id = ?`).run(userId, workspaceId);
  return Number(info.changes) > 0;
}

/** The user's role on a specific team (or null if not a member). The single call
 *  the server-side capability gate resolves before asking roleCan(role, cap). */
export function roleForUserInWorkspace(userId: string, workspaceId: string): MemberRole | null {
  return getMembership(userId, workspaceId)?.role ?? null;
}
