import { NextResponse, type NextRequest } from "next/server";
import { requireCapability, currentUser } from "@/app/_lib/auth/current-user";
import { DEFAULT_ORG_ID } from "@/app/_lib/db/organizations";
import { getUserById } from "@/app/_lib/db/users";
import { DEFAULT_WORKSPACE_ID } from "@/app/_lib/db/workspaces";
import { changeMemberRole, setMemberPermissions, setMemberStatus, removeMember, type MemberOpResult } from "@/app/_lib/org-service";
import { isMemberRole, sanitizeOverride, type Capability } from "@/app/_lib/auth/roles";

// HTTP status for a service guard outcome: 409 for the last-owner backstop, 404
// for a missing user/membership, 400 otherwise.
function opStatus(reason?: MemberOpResult["reason"]): number {
  if (reason === "last_owner") return 409;
  if (reason === "not_member" || reason === "no_user") return 404;
  return 400;
}

// Update a member (P0): role, status, and/or per-user permission overrides on a
// team. members:manage-gated; the service enforces last-owner protection.
export async function PATCH(request: NextRequest, context: { params: Promise<{ userId: string }> }) {
  const denied = await requireCapability("members:manage");
  if (denied) return denied;
  const { userId } = await context.params;
  const actor = await currentUser();
  const orgId = actor.orgId ?? DEFAULT_ORG_ID;
  const target = getUserById(userId);
  if (!target || target.orgId !== orgId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as {
    workspaceId?: unknown;
    role?: unknown;
    status?: unknown;
    overrides?: { grant?: unknown; revoke?: unknown } | null;
  };
  const workspaceId = typeof body.workspaceId === "string" && body.workspaceId ? body.workspaceId : DEFAULT_WORKSPACE_ID;

  if (body.role !== undefined) {
    if (!isMemberRole(body.role)) return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    const r = changeMemberRole(userId, workspaceId, body.role);
    if (!r.ok) return NextResponse.json({ error: r.reason }, { status: opStatus(r.reason) });
  }
  if (body.status !== undefined) {
    if (body.status !== "active" && body.status !== "disabled") return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    const r = setMemberStatus(userId, body.status);
    if (!r.ok) return NextResponse.json({ error: r.reason }, { status: opStatus(r.reason) });
  }
  if (body.overrides !== undefined) {
    // Delegation guard: an actor can only GRANT capabilities they hold themselves
    // (org:manage is already non-grantable via sanitizeOverride). Revokes are free.
    const sanitized = body.overrides === null ? null : sanitizeOverride(body.overrides);
    const actorCaps = new Set<Capability>(actor.capabilities);
    const filtered = sanitized ? { grant: sanitized.grant.filter((c) => actorCaps.has(c)), revoke: sanitized.revoke } : null;
    const effective = filtered && (filtered.grant.length || filtered.revoke.length) ? filtered : null;
    const r = setMemberPermissions(userId, workspaceId, effective);
    if (!r.ok) return NextResponse.json({ error: r.reason }, { status: opStatus(r.reason) });
  }
  return NextResponse.json({ ok: true });
}

// Remove a member entirely (user + credentials + memberships). members:manage;
// the service refuses to remove the org's last owner.
export async function DELETE(_request: NextRequest, context: { params: Promise<{ userId: string }> }) {
  const denied = await requireCapability("members:manage");
  if (denied) return denied;
  const { userId } = await context.params;
  const orgId = (await currentUser()).orgId ?? DEFAULT_ORG_ID;
  const target = getUserById(userId);
  if (!target || target.orgId !== orgId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const r = removeMember(userId);
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: opStatus(r.reason) });
  return NextResponse.json({ ok: true });
}
