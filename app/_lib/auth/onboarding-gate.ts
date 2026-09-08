import { currentSession } from "./current-user";
import { currentUserId, currentWorkspaceId, DEFAULT_WORKSPACE, DEMO_WORKSPACE, type SessionPayload } from "./session";
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

/**
 * Whether the principal has FINISHED first-run setup — the "completed" stamp, and
 * only that one.
 *
 * `needsOnboarding` above answers "should the wizard fire?", and a SKIP closes it
 * just as firmly as a finish. That is the whole reason this second reading exists:
 * a skipped principal is done being asked but is not set up, and the empty Pipeline
 * board's resume affordance is the way back in (`shell/setup/useSetupUnfinished.ts`
 * decides whether to offer it, `shell/setup/onboardingReopen.ts` opens it). Nothing
 * else in the first-run derivation is a stored flag — every other field is derived
 * from what exists in the workspace — but "did you finish the wizard" is not
 * derivable from any artefact, so this reads the one record the app actually
 * keeps.
 *
 * Same user-else-workspace identity split as `needsOnboarding`, and both stamp
 * writers keep "completed" winning over a later "skipped" (`markUserOnboarding`
 * clears the skip column; `setWorkspaceOnboardingState` refuses the downgrade), so
 * skipping first and finishing later reads as finished.
 *
 * Takes the session the caller already resolved rather than reading the cookie a
 * second time.
 */
export function onboardingFinished(session: SessionPayload | null, workspaceId: string): boolean {
  const userId = currentUserId(session);
  if (userId) return getUserById(userId)?.onboardingCompletedAt != null;
  return getWorkspaceOnboardingState(workspaceId) === "completed";
}
