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
/**
 * Who the wizard's saved draft belongs to.
 *
 * The first-run wizard mirrors its answers into sessionStorage so a reload three
 * steps in does not throw away the org name, the staged invites and the board
 * draft (setupDraft.ts). sessionStorage survives a logout/login inside one tab, so
 * that slot has to be keyed by principal — otherwise the next person to sign in on
 * this machine is handed the previous one's half-finished setup.
 *
 * It answers the SAME identity split the stamp above writes under: the user row
 * when the session has one, else the workspace (open dev mode / operator
 * password). The value is an opaque scope string the caller already has the right
 * to know — its own — and nothing is created by asking.
 */
export async function GET() {
  const session = await currentSession();
  const userId = currentUserId(session);
  const scope = userId ? `u:${userId}` : `w:${session ? currentWorkspaceId(session) : DEFAULT_WORKSPACE}`;
  return NextResponse.json({ scope });
}

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
