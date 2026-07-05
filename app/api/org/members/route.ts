import { NextResponse } from "next/server";
import { requireCapability, currentUser, callerCapabilities } from "@/app/_lib/auth/current-user";
import { DEFAULT_ORG_ID } from "@/app/_lib/db/organizations";
import { listOrgMembers } from "@/app/_lib/org-service";

// The org's member roster (P0). Any member with read may see it; mutations live on
// the [userId] route behind members:manage. Returns the caller's own capabilities
// so the UI knows which controls to show and which permissions it may delegate.
export async function GET() {
  const denied = await requireCapability("read");
  if (denied) return denied;
  const orgId = (await currentUser()).orgId ?? DEFAULT_ORG_ID;
  const caps = await callerCapabilities();
  return NextResponse.json({
    members: listOrgMembers(orgId),
    canManage: caps.includes("members:manage"),
    callerCapabilities: caps,
  });
}
