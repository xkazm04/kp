import { NextResponse, type NextRequest } from "next/server";
import { callerDelegationCeiling, currentUser, requireWorkspaceCapability } from "@/app/_lib/auth/current-user";
import { DEFAULT_ORG_ID } from "@/app/_lib/db/organizations";
import { getUserById } from "@/app/_lib/db/users";
import { getMembership } from "@/app/_lib/db/memberships";
import { addMemberToWorkspace, changeMemberRole, removeMemberFromWorkspace, type MemberOpResult } from "@/app/_lib/org-service";
import { canAssignRole, isMemberRole } from "@/app/_lib/auth/roles";

// One person's membership on one team (P2) — the write path behind the Workspaces
// console, where a member can belong to several teams at once.
//
// PUT    add the person to this team, or change the role they hold here (upsert).
// DELETE take them off this team only. Their ACCOUNT and every other membership
//        survive — deleting the account is DELETE /api/org/members/[userId], a
//        deliberately separate and differently-worded action.
//
// PER-USER CAPABILITY tuning on an existing membership keeps flowing through
// PATCH /api/org/members/[userId] (which owns the capability-delegation delta);
// this route does not duplicate that logic. Its ROLE write, though, is an upsert
// that can land on an existing membership, so it shares that route's last-owner
// backstop (org-service.changeMemberRole) — see the note on the write below.

function opStatus(reason?: MemberOpResult["reason"]): number {
  if (reason === "last_owner") return 409;
  if (reason === "not_member" || reason === "no_user" || reason === "no_workspace") return 404;
  if (reason === "cross_org") return 403;
  return 400;
}

/** Both verbs share the same gate: members:manage on the TARGET workspace (org-wide
 *  admins hold it everywhere in their org), plus the target user must be in the
 *  caller's own org. */
async function guard(workspaceId: string, userId: string): Promise<NextResponse | null> {
  const denied = await requireWorkspaceCapability(workspaceId, "members:manage");
  if (denied) return denied;
  const orgId = (await currentUser()).orgId ?? DEFAULT_ORG_ID;
  const target = getUserById(userId);
  if (!target || target.orgId !== orgId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return null;
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string; userId: string }> }) {
  const { id, userId } = await context.params;
  const denied = await guard(id, userId);
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as { role?: unknown };
  if (!isMemberRole(body.role)) return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  // Delegation, the same rule PATCH /api/org/members/[userId] applies: seating
  // someone at a role grants that role's capabilities, and nobody may hand out
  // privilege they do not hold. The ceiling is measured ORG-WIDE, not on this team
  // — an admin staffing a team they don't sit on holds no `pipeline:write` THERE,
  // and checking locally would refuse every seat they are explicitly authorized to
  // create. `org:manage` is still unreachable for anyone who lacks it, so `owner`
  // remains owner-only (see orgCapabilityCeiling's contract).
  if (!canAssignRole(await callerDelegationCeiling(), body.role)) {
    return NextResponse.json({ error: "Cannot assign a role above your own privileges" }, { status: 403 });
  }
  // Demoting somebody who ALREADY holds `owner` here is a role CHANGE, not a seat,
  // so it has to clear the org's last-owner backstop. addMemberToWorkspace is a plain
  // upsert with no such guard: PUT {"role":"recruiter"} on the org's only owner left
  // the organization with nobody holding `org:manage`, and because `owner` may only be
  // granted by a caller who already holds it (canAssignRole, above) NOBODY could ever
  // restore it — billing, org settings and the backup routes are gated on that
  // capability. DELETE on this very route already refuses exactly that outcome
  // (409 last_owner) and so does PATCH /api/org/members/[userId]; only PUT did not.
  const seated = getMembership(userId, id);
  const r =
    seated?.role === "owner" && body.role !== "owner"
      ? changeMemberRole(userId, id, body.role)
      : addMemberToWorkspace(userId, id, body.role);
  if (!r.ok) return NextResponse.json({ error: r.reason, code: r.reason }, { status: opStatus(r.reason) });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string; userId: string }> }) {
  const { id, userId } = await context.params;
  const denied = await guard(id, userId);
  if (denied) return denied;
  const r = removeMemberFromWorkspace(userId, id);
  if (!r.ok) return NextResponse.json({ error: r.reason, code: r.reason }, { status: opStatus(r.reason) });
  return NextResponse.json({ ok: true });
}
