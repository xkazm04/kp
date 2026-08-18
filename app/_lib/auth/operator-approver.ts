// The SYNCHRONOUS half of this module is pure (no next/headers, no DB) so it stays safe
// to import from server libs (screen-wave) AND route handlers without dragging
// request-scope imports into the lib bundle. The async half below reaches for the
// signed-in person; it keeps the static import graph clean by resolving `next/headers`
// and the DB through dynamic `import()` at call time.

/** The human approver name written into a sealed adverse-decision record (Art.22 /
 *  EU-AI-Act human-in-the-loop) when the request carries NO identified person. The
 *  prior hardcoded "operator (in-app approval)" named NOBODY in the immutable record —
 *  the central "who reviewed this" claim was a constant string for every in-app commit.
 *  Name the actual reviewer via KP_OPERATOR_NAME for a defensible record; absent that,
 *  state the posture honestly rather than imply a specific person reviewed it.
 *
 *  Still the FALLBACK, not the answer (UAT LUC-ANA-4 / gap G5): an open, keyless,
 *  single-operator deployment genuinely has no named user, and inventing one would be
 *  the same overclaim in a new coat. resolveApprover() below prefers the real person
 *  and lands here only when there isn't one. */
export function operatorApprover(): string {
  return process.env.KP_OPERATOR_NAME?.trim() || "operator (single-operator deployment)";
}

/** The decision-chain actor token for a human act by an UNIDENTIFIED person — the role,
 *  which is all a session without identity can honestly assert. */
export const HUMAN_ROLE_ACTOR = "human:recruiter";

/** The natural person behind THIS request, or null when the deployment cannot name one.
 *
 *  UAT LUC-ANA-4 — Lucie's finding was that five identified users with memberships sat
 *  in the same database while every decision recorded a class ("human:recruiter", AUTO,
 *  "operator"). currentUserId() + the users row closes that: when the session carries
 *  identity, the decision gets a name.
 *
 *  SERVER-BOUND (guardrail G3): the name is derived from the signed session cookie and
 *  the users table, never from a request body — a caller must not be able to attribute a
 *  decision to someone else. Returns null (never a guess) on any failure: outside a
 *  request, on a session without `sub`, or when the id no longer resolves to a user.
 *
 *  Dynamic imports keep next/headers + better-sqlite3 out of the static graph of the
 *  pure server libs (screen-wave) that import operatorApprover(). */
export async function approverIdentity(): Promise<string | null> {
  try {
    const [{ currentSession }, { currentUserId }] = await Promise.all([import("./current-user"), import("./session")]);
    const userId = currentUserId(await currentSession());
    if (!userId) return null;
    const { getUserById } = await import("../db/users");
    const user = getUserById(userId);
    if (!user) return null;
    // Prefer the display name a colleague would recognize; an account that never set one
    // is still identified by its email, which is the account's own stable handle.
    return user.name?.trim() || user.email.trim() || null;
  } catch {
    return null;
  }
}

/** The Art. 22 approver for a sealed record: the named person when the session carries
 *  identity, else operatorApprover()'s honest posture string. */
export async function resolveApprover(): Promise<string> {
  return (await approverIdentity()) ?? operatorApprover();
}

/** The decision-chain actor token for a human act: "human:<Name>" when the request
 *  carries identity, else the unchanged role token. Written to pipeline_events.actor and
 *  to the sealed record's `actor` field so the log row and its seal name the same actor. */
export async function humanActor(): Promise<string> {
  const who = await approverIdentity();
  return who ? `human:${who}` : HUMAN_ROLE_ACTOR;
}
