import { NextResponse } from "next/server";
import { currentSession } from "@/app/_lib/auth/current-user";
import { currentOrgId, currentWorkspaceId, DEFAULT_WORKSPACE, DEMO_WORKSPACE } from "@/app/_lib/auth/session";
import { onboardingFinished } from "@/app/_lib/auth/onboarding-gate";
import { computeGettingStarted } from "@/app/_lib/getting-started";

// GET /api/me/getting-started — the data-derived state of a workspace's first-run
// progress (see app/_lib/getting-started.ts). Same self-service gate as
// POST /api/me/onboarding: any signed-in member may read their own workspace's
// progress; demo sessions have none.
//
// Its live consumer is `shell/setup/useSetupUnfinished.ts`, which reads
// `setupFinished` so the empty Pipeline board can offer a way back into an
// unfinished first run. The rest of the payload is the honest derivation behind
// it and is what any future first-run surface would otherwise recompute.
export async function GET() {
  const session = await currentSession();
  if (process.env.KP_OPERATOR_PASSWORD) {
    if (!session || currentWorkspaceId(session) === DEMO_WORKSPACE) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  const workspace = session ? currentWorkspaceId(session) : DEFAULT_WORKSPACE;
  // The one field that is not derived from workspace artefacts: whether this
  // principal actually FINISHED the first-run wizard (a skip does not count — see
  // onboardingFinished). It is also the only field with a UI consumer today.
  return NextResponse.json(
    await computeGettingStarted(workspace, currentOrgId(session), onboardingFinished(session, workspace))
  );
}
