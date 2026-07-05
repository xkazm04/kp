import { NextResponse, type NextRequest } from "next/server";
import { requireCapability, currentUser } from "@/app/_lib/auth/current-user";
import { DEFAULT_ORG_ID } from "@/app/_lib/db/organizations";
import { getInvite, revokeInvite } from "@/app/_lib/db/invites";

// Revoke a pending invite. members:manage-gated; scoped to the actor's org so one
// org can't revoke another's invite by guessing a token.
export async function DELETE(_request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const denied = await requireCapability("members:manage");
  if (denied) return denied;
  const { token } = await context.params;
  const orgId = (await currentUser()).orgId ?? DEFAULT_ORG_ID;
  const invite = getInvite(token);
  if (!invite || invite.orgId !== orgId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!revokeInvite(token)) return NextResponse.json({ error: "Invite is not pending." }, { status: 409 });
  return NextResponse.json({ ok: true });
}
