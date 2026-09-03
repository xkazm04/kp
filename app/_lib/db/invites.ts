import { ensureDb } from "./core";
import { randomToken } from "../random-id";
import { normalizeEmail } from "./users";
import type { MemberRole } from "../auth/roles";

// Invites (P0) — a pending invitation to join an org (and optionally a specific
// team). `token` is the unguessable accept link (randomToken, CSPRNG). Replaces
// the mocked InviteEditor: an invite is a real, redeemable, expiring record.

export type InviteStatus = "pending" | "accepted" | "revoked";

export type Invite = {
  token: string;
  orgId: string;
  workspaceId: string | null;
  email: string;
  role: MemberRole;
  status: InviteStatus;
  invitedBy: string | null;
  createdAt: string;
  expiresAt: string | null;
  acceptedAt: string | null;
};

const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

function rowToInvite(r: Record<string, unknown>): Invite {
  return {
    token: r.token as string,
    orgId: r.org_id as string,
    workspaceId: (r.workspace_id as string) ?? null,
    email: r.email as string,
    role: r.role as MemberRole,
    status: r.status as InviteStatus,
    invitedBy: (r.invited_by as string) ?? null,
    createdAt: r.created_at as string,
    expiresAt: (r.expires_at as string) ?? null,
    acceptedAt: (r.accepted_at as string) ?? null,
  };
}

export type CreateInviteInput = {
  orgId: string;
  email: string;
  role: MemberRole;
  workspaceId?: string | null;
  invitedBy?: string | null;
};

export function createInvite(input: CreateInviteInput, now: number = Date.now()): Invite {
  const db = ensureDb();
  const token = randomToken("inv");
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + INVITE_TTL_MS).toISOString();
  const email = normalizeEmail(input.email);
  db.prepare(
    `INSERT INTO invites (token, org_id, workspace_id, email, role, status, invited_by, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
  ).run(token, input.orgId, input.workspaceId ?? null, email, input.role, input.invitedBy ?? null, createdAt, expiresAt);
  return {
    token,
    orgId: input.orgId,
    workspaceId: input.workspaceId ?? null,
    email,
    role: input.role,
    status: "pending",
    invitedBy: input.invitedBy ?? null,
    createdAt,
    expiresAt,
    acceptedAt: null,
  };
}

export function getInvite(token: string): Invite | null {
  const db = ensureDb();
  const r = db.prepare(`SELECT * FROM invites WHERE token = ?`).get(token) as Record<string, unknown> | undefined;
  return r ? rowToInvite(r) : null;
}

export function listInvitesForOrg(orgId: string, status?: InviteStatus): Invite[] {
  const db = ensureDb();
  const rows = status
    ? db.prepare(`SELECT * FROM invites WHERE org_id = ? AND status = ? ORDER BY created_at DESC`).all(orgId, status)
    : db.prepare(`SELECT * FROM invites WHERE org_id = ? ORDER BY created_at DESC`).all(orgId);
  return (rows as Record<string, unknown>[]).map(rowToInvite);
}

/** A pending, non-expired invite for this token, or null — the gate the accept
 *  flow checks before minting the user/membership. */
export function getRedeemableInvite(token: string, now: number = Date.now()): Invite | null {
  const inv = getInvite(token);
  if (!inv || inv.status !== "pending") return null;
  if (inv.expiresAt && Date.parse(inv.expiresAt) < now) return null;
  return inv;
}

/** Mark a pending invite accepted (guarded on status='pending' so a double-redeem
 *  is a no-op). Returns false when nothing pending matched. */
export function markInviteAccepted(token: string, now: number = Date.now()): boolean {
  const db = ensureDb();
  const info = db
    .prepare(`UPDATE invites SET status = 'accepted', accepted_at = ? WHERE token = ? AND status = 'pending'`)
    .run(new Date(now).toISOString(), token);
  return Number(info.changes) > 0;
}

/** Revoke every PENDING invite addressed to one email inside one org, returning how
 *  many were killed.
 *
 *  An invite is a deferred account: redeeming one activates (or creates) the user
 *  with the invited role and a fresh password. So removing or disabling a member
 *  without revoking the invites addressed to their email left a live resurrection
 *  link behind — the admin saw the seat disappear from the roster while an old
 *  mail in the ex-member's inbox still re-minted the account, with a password only
 *  they knew. Scoped to ONE org on purpose: a person removed from org A may hold a
 *  legitimate pending invite from org B, and that link is none of A's business. */
export function revokePendingInvitesForEmail(orgId: string, email: string): number {
  const db = ensureDb();
  const info = db
    .prepare(`UPDATE invites SET status = 'revoked' WHERE org_id = ? AND email = ? AND status = 'pending'`)
    .run(orgId, normalizeEmail(email));
  return Number(info.changes);
}

export function revokeInvite(token: string): boolean {
  const db = ensureDb();
  const info = db.prepare(`UPDATE invites SET status = 'revoked' WHERE token = ? AND status = 'pending'`).run(token);
  return Number(info.changes) > 0;
}
