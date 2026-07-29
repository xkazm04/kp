import { currentSession } from "./current-user";
import { currentUserId, currentWorkspaceId, DEFAULT_WORKSPACE, DEMO_WORKSPACE } from "./session";
import { getUserById } from "../db/users";
import { getWorkspaceOnboardingState } from "../db/workspaces";

// First-run onboarding gate for '/' (server-side). Fires the setup wizard exactly
// once per principal: per USER when the session carries an identity claim, per
// WORKSPACE otherwise (open dev mode / operator password — current-user resolves
// no user id there). The demo workspace (?sim=auto guided tour) never onboards:
// the simulation IS its onboarding. Called only after the entered gate passes, so
// the anonymous landing stays DB-free (home-gate-server's deliberate property).

type EnvLike = Record<string, string | undefined>;

/** Dev aid: KP_FORCE_ONBOARDING=1 shows the wizard on EVERY load of '/'. */
export function forceOnboarding(env: EnvLike = process.env): boolean {
  const v = (env.KP_FORCE_ONBOARDING ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export async function needsOnboarding(): Promise<boolean> {
  if (forceOnboarding()) return true;
  const session = await currentSession();
  const workspace = session ? currentWorkspaceId(session) : DEFAULT_WORKSPACE;
  if (workspace === DEMO_WORKSPACE) return false;
  const userId = currentUserId(session);
  if (userId) {
    const user = getUserById(userId);
    return user !== null && user.onboardingCompletedAt === null && user.onboardingSkippedAt === null;
  }
  return getWorkspaceOnboardingState(workspace) === null;
}
