import { NextResponse } from "next/server";
import { currentSession } from "@/app/_lib/auth/current-user";
import { currentUserId, currentWorkspaceId, DEFAULT_WORKSPACE, DEMO_WORKSPACE } from "@/app/_lib/auth/session";
import { markUserOnboarding } from "@/app/_lib/db/users";
import { setWorkspaceOnboardingState } from "@/app/_lib/db/workspaces";

// Self-service first-run onboarding stamp: the wizard posts "completed" when
// finished and "skipped" on Skip/Escape/X so the '/' gate (onboarding-gate.ts)
// never re-fires it. Deliberately NOT an operator route — any signed-in member
// stamps their OWN user row; identity-less sessions (open dev mode, operator
// password) fall back to the workspace-level state, same split as the gate.
export async function POST(req: Request) {
  const session = await currentSession();
  if (process.env.KP_OPERATOR_PASSWORD) {
    // Password mode: a real, non-demo session is required. Demo visitors (guided
    // tour) have no onboarding state to write.
    if (!session || currentWorkspaceId(session) === DEMO_WORKSPACE) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  let status: unknown;
  try {
    status = ((await req.json()) as { status?: unknown })?.status;
  } catch {
    /* fall through to the 400 */
  }
  if (status !== "completed" && status !== "skipped") {
    return NextResponse.json({ error: "status must be 'completed' or 'skipped'" }, { status: 400 });
  }
  const userId = currentUserId(session);
  if (userId) {
    markUserOnboarding(userId, status);
  } else {
    setWorkspaceOnboardingState(status, session ? currentWorkspaceId(session) : DEFAULT_WORKSPACE);
  }
  return NextResponse.json({ ok: true });
}
