import { NextResponse, type NextRequest } from "next/server";
import { requireCapability, currentUser, callerCapabilities } from "@/app/_lib/auth/current-user";
import { DEFAULT_ORG_ID } from "@/app/_lib/db/organizations";
import { getUserById } from "@/app/_lib/db/users";
import { getMembership } from "@/app/_lib/db/memberships";
import { DEFAULT_WORKSPACE_ID } from "@/app/_lib/db/workspaces";
import { changeMemberRole, setMemberPermissions, setMemberStatus, removeMember, type MemberOpResult } from "@/app/_lib/org-service";
import { isMemberRole, isCapability, overrideFromDesired, canAssignRole, type Capability } from "@/app/_lib/auth/roles";

// HTTP status for a service guard outcome: 409 for the last-owner backstop, 404
// for a missing user/membership, 400 otherwise.
function opStatus(reason?: MemberOpResult["reason"]): number {
  if (reason === "last_owner") return 409;
  if (reason === "not_member" || reason === "no_user") return 404;
  return 400;
}

// Update a member (P0): role, status, and/or the desired capability set on a team.
// members:manage-gated; the service enforces last-owner protection, and permission
// grants are capped to what the acting user can delegate.
export async function PATCH(request: NextRequest, context: { params: Promise<{ userId: string }> }) {
  const denied = await requireCapability("members:manage");
  if (denied) return denied;
  const { userId } = await context.params;
  const orgId = (await currentUser()).orgId ?? DEFAULT_ORG_ID;
  const target = getUserById(userId);
  if (!target || target.orgId !== orgId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as {
    workspaceId?: unknown;
    role?: unknown;
    status?: unknown;
    capabilities?: unknown;
  };
  const workspaceId = typeof body.workspaceId === "string" && body.workspaceId ? body.workspaceId : DEFAULT_WORKSPACE_ID;

  if (body.role !== undefined) {
    if (!isMemberRole(body.role)) return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    // Delegation, same rule as the capability path below: a role assignment grants that
    // role's capabilities, and the actor may not grant privilege they lack. `members:manage`
    // alone (an admin) could otherwise PATCH itself to `owner` and seize org:manage.
    if (!canAssignRole(await callerCapabilities(), body.role)) {
      return NextResponse.json({ error: "Cannot assign a role above your own privileges" }, { status: 403 });
    }
    const r = changeMemberRole(userId, workspaceId, body.role);
    if (!r.ok) return NextResponse.json({ error: r.reason }, { status: opStatus(r.reason) });
  }
  if (body.status !== undefined) {
    if (body.status !== "active" && body.status !== "disabled") return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    const r = setMemberStatus(userId, body.status);
    if (!r.ok) return NextResponse.json({ error: r.reason }, { status: opStatus(r.reason) });
  }
  if (body.capabilities !== undefined) {
    if (!Array.isArray(body.capabilities)) return NextResponse.json({ error: "Invalid capabilities" }, { status: 400 });
    const membership = getMembership(userId, workspaceId);
    if (!membership) return NextResponse.json({ error: "not_member" }, { status: 404 });
    const desired: Capability[] = (body.capabilities as unknown[]).filter(isCapability);
    // The override the desired set implies vs the member's (possibly just-changed) role.
    const override = overrideFromDesired(membership.role, desired);
    // Delegation: the actor may only GRANT capabilities they hold themselves
    // (org:manage is already non-grantable). Revokes are unrestricted. But the
    // client re-sends the WHOLE desired set, so `override.grant` recomputes grants
    // for capabilities the actor never touched — including pre-existing ones the
    // member already had. Cap delegation to the DELTA the actor is actually
    // introducing: a grant survives if the actor can delegate it OR it already
    // existed on the member. Otherwise a partial delegate toggling one unrelated
    // switch would silently strip a teammate's pre-existing (undelegatable) grant.
    const actorCaps = new Set<Capability>(await callerCapabilities());
    const preExistingGrants = new Set<Capability>(membership.overrides?.grant ?? []);
    const filtered = override
      ? { grant: override.grant.filter((c) => actorCaps.has(c) || preExistingGrants.has(c)), revoke: override.revoke }
      : null;
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
