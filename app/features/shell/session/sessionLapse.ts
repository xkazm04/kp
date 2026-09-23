// The workspace shell's session-lapse contract, as pure decisions (the hook
// useSessionLapse.ts and SessionLapseDialog.tsx are thin wiring over these; kp
// cannot load .tsx under node:test, so every branch that matters lives here).
//
// Why it exists. A signed session lives exactly SESSION_TTL_MS (7 days) and only the
// sign-in doors mint one, so every signed-in user's session ends mid-work once a
// week. The proxy then answers the next write with a bare 401, and the pipeline /
// JD / bulk surfaces fold that into "you don't have permission" — blaming a
// permission the user holds, with no way to sign in from the page. The shell now
// learns the token's expiry from its own /api/me/capabilities read, warns
// WARN_BEFORE_MS ahead, and on a lapse re-signs in OVER the page.
//
// Fail-closed. Nothing here extends a session: the only way out of "lapsed" is a
// real POST to the login door (auth/session-issuer.ts mints, with its own cookie
// attributes). A different person signing in never inherits the page: reload.

/** The caller's own session, as GET /api/me/capabilities answers it. */
export type SessionFacts = {
  kind: "user" | "operator";
  /** null for the operator (no per-user identity). */
  userId: string | null;
  /** The caller's own email (null for the operator) — prefills the re-sign-in. */
  email: string | null;
  workspaceId: string;
  /** Epoch ms — the verified token's `exp`. */
  expiresAt: number;
};

export type LapseInput = {
  /** KP_OPERATOR_PASSWORD is set. Open mode never lapses. */
  passwordMode: boolean;
  session: SessionFacts | null;
};

export type PhaseName = "live" | "expiring" | "lapsed";

export type Phase =
  | { phase: "live"; nextCheckAt: number | null }
  | { phase: "expiring"; minutesLeft: number; nextCheckAt: number }
  | { phase: "lapsed"; nextCheckAt: null };

/** How long before expiry the shell starts warning. */
export const WARN_BEFORE_MS = 10 * 60_000;
const MINUTE = 60_000;

/** Where the session stands at `now`, and when to look again (null = never). */
export function phaseAt(input: LapseInput, now: number): Phase {
  const s = input.session;
  // Open mode, or a document with no signed session to watch (demo, anonymous).
  if (!input.passwordMode || !s) return { phase: "live", nextCheckAt: null };
  const left = s.expiresAt - now;
  if (left <= 0) return { phase: "lapsed", nextCheckAt: null };
  if (left > WARN_BEFORE_MS) return { phase: "live", nextCheckAt: s.expiresAt - WARN_BEFORE_MS };
  // Look again when the whole-minute count changes, never later than expiry itself.
  const toNextMinute = left % MINUTE || MINUTE;
  return { phase: "expiring", minutesLeft: Math.ceil(left / MINUTE), nextCheckAt: Math.min(s.expiresAt, now + toNextMinute) };
}

/** A response status observed by the shell. Only a 401 means the session is gone:
 *  a 403 is under-privilege on a live session, a 5xx is an outage. */
export function lapseOnStatus(phase: PhaseName, status: number): PhaseName {
  return status === 401 ? "lapsed" : phase;
}

/** The outcome of re-reading the caller's own session (at a due timer, or on
 *  return to the tab) — the server, not the local clock, decides a lapse, so a
 *  re-sign-in in another tab is adopted instead of prompting here. */
export type SessionRead = { status: number; session?: SessionFacts | null };

export function reconcileRead(armed: SessionFacts | null, read: SessionRead): { lapsed: boolean; session: SessionFacts | null } {
  if (read.status >= 200 && read.status < 300) {
    const next = read.session ?? null;
    // A session we were watching is gone although the read succeeded.
    if (armed && !next) return { lapsed: true, session: armed };
    return { lapsed: false, session: next };
  }
  // Nothing armed (open mode): a failed read never invents a lapse.
  if (!armed) return { lapsed: false, session: null };
  return { lapsed: read.status === 401, session: armed };
}

export type ReauthAction = { action: "resume" } | { action: "switch"; workspaceId: string } | { action: "reload" };

/** After a successful in-place sign-in: whose page is this now? */
export function resolveReauth(lapsed: SessionFacts, fresh: SessionFacts | null): ReauthAction {
  // A sign-in that left no readable session is never resumed on faith.
  if (!fresh) return { action: "reload" };
  // A different person (or the operator for a user, or vice versa): the page's
  // client state belonged to someone else.
  if (fresh.kind !== lapsed.kind || fresh.userId !== lapsed.userId) return { action: "reload" };
  // The login door lands a user on their FIRST team; take them back to this one
  // through the membership-checked switch door.
  if (fresh.workspaceId !== lapsed.workspaceId) return { action: "switch", workspaceId: lapsed.workspaceId };
  return { action: "resume" };
}

/** The switch back's answer: anything but 2xx (membership gone meanwhile, the
 *  account refused) reloads to '/' rather than resuming on the wrong team. */
export function resolveSwitch(status: number): "resume" | "reload" {
  return status >= 200 && status < 300 ? "resume" : "reload";
}

/** Parse the `session` field of GET /api/me/capabilities defensively. */
export function parseSessionFacts(raw: unknown): SessionFacts | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.kind !== "user" && r.kind !== "operator") return null;
  if (typeof r.workspaceId !== "string" || typeof r.expiresAt !== "number" || !Number.isFinite(r.expiresAt)) return null;
  return {
    kind: r.kind,
    userId: typeof r.userId === "string" ? r.userId : null,
    email: typeof r.email === "string" ? r.email : null,
    workspaceId: r.workspaceId,
    expiresAt: r.expiresAt,
  };
}
