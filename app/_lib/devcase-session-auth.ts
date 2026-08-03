import { createHash, timingSafeEqual } from "node:crypto";

// A dev-case session id is NOT an authorization capability.
//
// `/api/devcase/session*` is public by design (public-routes.ts) — the candidate has no
// account, the apply link IS the credential. But the three session sub-routes used to
// authorize on session EXISTENCE + STATUS alone, so anyone holding a session id (a copied
// devtools request, a shared screen, a proxied network log) could append process events,
// overwrite `files_json` — destroying another candidate's submitted work — and burn the
// chat/LLM budget of a session they never started.
//
// The fix is to bind the session id back to the apply token that minted it: every
// mutating call must PRESENT that token, and the route re-checks it against
// `dev_sessions.token`. This is defence in depth, not secrecy: the apply link is shared
// with every candidate for a posting, so presenting it proves only "I came through the
// front door of this posting" — which is exactly the authority a session id alone was
// wrongly granting.
//
// TOKENLESS SESSIONS. Rows minted directly (unit fixtures, dev seeds) carry `token: null`.
// There is no owning apply token to re-check, so they are left to their own gate — the
// same carve-out `interview-connect` makes for tokenless lab sessions. The public
// `POST /api/devcase/session` route always requires a token, so no session reachable
// from the product can take this branch.

function digest(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}

/** True when `presented` is the apply token that owns this session. Hash-then-compare
 *  (the `api/auth/login` convention) so the comparison is constant-time and safe for
 *  unequal lengths. */
export function sessionTokenMatches(sessionToken: string | null | undefined, presented: unknown): boolean {
  if (!sessionToken) return false;
  if (typeof presented !== "string") return false;
  const candidate = presented.trim();
  if (!candidate) return false;
  return timingSafeEqual(digest(candidate), digest(sessionToken));
}

/** Shared 403 body for a session id presented without (or with the wrong) apply token.
 *  Deliberately NOT 404/409: those two codes tell `LiveWorkSurface` the session is dead
 *  and to re-mint, which for a client that simply hasn't sent a token yet would spin the
 *  per-token/day session quota. 403 keeps the buffered draft and the session id intact. */
export const SESSION_TOKEN_REQUIRED = "This work session belongs to a different apply link.";
