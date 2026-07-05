import { NextResponse, type NextRequest } from "next/server";
import { requireCapability, currentUser } from "@/app/_lib/auth/current-user";
import { DEFAULT_ORG_ID } from "@/app/_lib/db/organizations";
import { getUserByEmail } from "@/app/_lib/db/users";
import { listInvitesForOrg } from "@/app/_lib/db/invites";
import { inviteMember } from "@/app/_lib/org-service";
import { isMemberRole } from "@/app/_lib/auth/roles";

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
  const workspaceId = typeof body.workspaceId === "string" && body.workspaceId ? body.workspaceId : undefined;

  // Guard against re-inviting an already-active member of this org.
  const existing = getUserByEmail(email);
  if (existing && existing.orgId === orgId && existing.status === "active") {
    return NextResponse.json({ error: "That person is already an active member." }, { status: 409 });
  }
  const invite = inviteMember({ orgId, email, role, workspaceId, invitedBy: actor.userId });
  return NextResponse.json({ invite });
}
