import { NextResponse } from "next/server";
import { requireCapability, currentUser } from "@/app/_lib/auth/current-user";
import { DEFAULT_ORG_ID } from "@/app/_lib/db/organizations";
import { listOrgMembers } from "@/app/_lib/org-service";

// The org's member roster (P0). Any member with read may see it; mutations live on
// the [userId] route behind members:manage.
export async function GET() {
  const denied = await requireCapability("read");
  if (denied) return denied;
  const orgId = (await currentUser()).orgId ?? DEFAULT_ORG_ID;
  return NextResponse.json({ members: listOrgMembers(orgId) });
}
