import { currentSession, currentUser } from "./auth/current-user";
import { isOperatorSession } from "./auth/session";
import { roleAtLeast, type MemberRole } from "./auth/roles";
import type { JdDeleteActor } from "./jds-delete-rule";

// The SESSION half of the JD delete door. The rule itself — actor + row → boolean —
// is `canDeleteJd` in jds-delete-rule.ts, kept import-free so it stays testable;
// this module answers the other question: who is the actor on this request.
//
// "Admin" here is owner or admin, the top two ranks of MEMBER_ROLES. A recruiter,
// hiring manager or viewer holds no delete authority beyond their own drafts.
export const JD_DELETE_MIN_ADMIN_ROLE: MemberRole = "admin";

export { canDeleteJd, type JdDeleteActor } from "./jds-delete-rule";

/** Resolve the actor from the session.
 *
 *  The two identity-less modes are deliberately treated as ADMIN, because that is
 *  already what the rest of the app resolves them to and a door that behaved
 *  differently would be invisible in exactly the setup most operators run:
 *   - OPEN DEV (no KP_OPERATOR_PASSWORD): `resolveCaller` in auth/current-user.ts
 *     folds the caller to the full owner capability set. There is no user id to
 *     stamp at save time and none to match here, so a creator-only door would
 *     delete nothing, ever.
 *   - OPERATOR-PASSWORD SESSION (`op: true`, no `sub`): the self-hosting operator,
 *     folded to owner by that same function. Same reasoning.
 *  Both are gated upstream by requireOperator, so neither is an anonymous caller.
 *
 *  Everything else reads the LIVE membership role on the session's workspace — the
 *  same source `currentUser()` serves the UI from — so a demotion lands on the next
 *  request without a re-login. */
export async function jdDeleteActor(): Promise<JdDeleteActor> {
  if (!process.env.KP_OPERATOR_PASSWORD) return { userId: null, isAdmin: true };
  const session = await currentSession();
  if (isOperatorSession(session)) return { userId: null, isAdmin: true };
  const user = await currentUser();
  return { userId: user.userId, isAdmin: roleAtLeast(user.role, JD_DELETE_MIN_ADMIN_ROLE) };
}
