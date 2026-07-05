import { ensureDb, safeRowParse } from "./core";
import { randomId } from "../random-id";
import { resolveCapabilities, sanitizeOverride, type Capability, type CapabilityOverride, type MemberRole } from "../auth/roles";

// Memberships (P0) — a user's link to ONE team (workspace) with a role + optional
// per-user permission overrides. Many-to-many by design (a recruiter can span
// several teams of the same org); the UNIQUE(user_id, workspace_id) index makes
// upsert one-role-per-user-per-team. The server gate resolves
// capabilitiesForUserInWorkspace() live — so a permission change lands next request.

export type Membership = {
  id: string;
  userId: string;
  workspaceId: string;
  role: MemberRole;
  overrides: CapabilityOverride | null;
  createdAt: string;
};

function rowToMembership(r: Record<string, unknown>): Membership {
  const parsed = safeRowParse<CapabilityOverride>((r.capability_overrides as string) ?? null, "membership.overrides", r.id as string);
  return {
    id: r.id as string,
    userId: r.user_id as string,
    workspaceId: r.workspace_id as string,
    role: r.role as MemberRole,
    // Re-sanitize on read so a hand-edited/legacy row can never surface an
    // org:manage grant or a malformed shape.
    overrides: parsed ? sanitizeOverride(parsed) : null,
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

/** The user's role on a specific team (or null if not a member). */
export function roleForUserInWorkspace(userId: string, workspaceId: string): MemberRole | null {
  return getMembership(userId, workspaceId)?.role ?? null;
}

/** Set/replace a member's per-user permission overrides (null clears them, back to
 *  pure role defaults). Sanitized before write. Returns false when no membership
 *  matched. This is the "adjust permission on the user level" write path. */
export function setMembershipOverrides(userId: string, workspaceId: string, overrides: CapabilityOverride | null): boolean {
  const db = ensureDb();
  const clean = overrides ? sanitizeOverride(overrides) : null;
  const json = clean ? JSON.stringify(clean) : null;
  const info = db.prepare(`UPDATE memberships SET capability_overrides = ? WHERE user_id = ? AND workspace_id = ?`).run(json, userId, workspaceId);
  return Number(info.changes) > 0;
}

/** The member's EFFECTIVE capabilities on a team (role defaults + overrides), or an
 *  empty set when they aren't a member. The live authority the request gate reads —
 *  a permission change takes effect on the next request, no re-login. */
export function capabilitiesForUserInWorkspace(userId: string, workspaceId: string): ReadonlySet<Capability> {
  const m = getMembership(userId, workspaceId);
  return m ? resolveCapabilities(m.role, m.overrides) : new Set<Capability>();
}
