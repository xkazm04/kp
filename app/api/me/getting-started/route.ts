import { NextResponse } from "next/server";
import { currentSession } from "@/app/_lib/auth/current-user";
import { currentOrgId, currentWorkspaceId, DEFAULT_WORKSPACE, DEMO_WORKSPACE } from "@/app/_lib/auth/session";
import { computeGettingStarted } from "@/app/_lib/getting-started";

// GET /api/me/getting-started — the data-derived state of the first-run
// checklist (see app/_lib/getting-started.ts). Same self-service gate as
// POST /api/me/onboarding: any signed-in member may read their own workspace's
// progress; demo sessions have none.
export async function GET() {
  const session = await currentSession();
  if (process.env.KP_OPERATOR_PASSWORD) {
    if (!session || currentWorkspaceId(session) === DEMO_WORKSPACE) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  const workspace = session ? currentWorkspaceId(session) : DEFAULT_WORKSPACE;
  return NextResponse.json(await computeGettingStarted(workspace, currentOrgId(session)));
}
