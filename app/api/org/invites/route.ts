import { NextResponse, type NextRequest } from "next/server";
import { requireCapability, currentUser, callerCapabilities } from "@/app/_lib/auth/current-user";
import { DEFAULT_ORG_ID } from "@/app/_lib/db/organizations";
import { getUserByEmail } from "@/app/_lib/db/users";
import { listInvitesForOrg } from "@/app/_lib/db/invites";
import { inviteMember } from "@/app/_lib/org-service";
import { isMemberRole, canAssignRole } from "@/app/_lib/auth/roles";

// Pending invites for the org. members:manage-gated (viewing invites is part of
// managing members).
export async function GET() {
  const denied = await requireCapability("members:manage");
  if (denied) return denied;
  const orgId = (await currentUser()).orgId ?? DEFAULT_ORG_ID;
  return NextResponse.json({ invites: listInvitesForOrg(orgId, "pending") });
}

// Invite a member (P0). members:manage. Returns the tokenized accept link so the
// UI can copy/share it (no email relay is configured in this app).
export async function POST(request: NextRequest) {
  const denied = await requireCapability("members:manage");
  if (denied) return denied;
  const actor = await currentUser();
  const orgId = actor.orgId ?? DEFAULT_ORG_ID;
  const body = (await request.json().catch(() => ({}))) as { email?: unknown; role?: unknown; workspaceId?: unknown };
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!email || !email.includes("@")) return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  const role = isMemberRole(body.role) ? body.role : "recruiter";
  // Same delegation rule as changing a member's role: inviting someone AT a role grants
  // that role's capabilities, so an admin cannot mint an `owner` invite and accept it.
  if (!canAssignRole(await callerCapabilities(), role)) {
    return NextResponse.json({ error: "Cannot invite at a role above your own privileges" }, { status: 403 });
  }
  const workspaceId = typeof body.workspaceId === "string" && body.workspaceId ? body.workspaceId : undefined;

  // Guard against re-inviting an already-active member of this org.
  const existing = getUserByEmail(email);
  if (existing && existing.orgId === orgId && existing.status === "active") {
    return NextResponse.json({ error: "That person is already an active member." }, { status: 409 });
  }
  const result = inviteMember({ orgId, email, role, workspaceId, invitedBy: actor.userId });
  if (!result.ok) {
    // A team outside the actor's org answers 404, the same way requireWorkspaceCapability
    // does: a cross-org probe must not learn that the id exists. `no_workspace` means the
    // actor's own org has no team to seat anyone on — a server-state problem, not a probe.
    return result.reason === "cross_org"
      ? NextResponse.json({ error: "Not found" }, { status: 404 })
      : NextResponse.json({ error: result.reason }, { status: 409 });
  }
  return NextResponse.json({ invite: result.invite });
}
