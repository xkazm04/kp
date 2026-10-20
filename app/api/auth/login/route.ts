import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { issueSession, landingWorkspaceFor, markEntered } from "@/app/_lib/auth/session-issuer";
import { verifyCredentials, normalizeEmail } from "@/app/_lib/db/users";
import { clientIpFrom, SHARED_CLIENT_KEY } from "@/app/_lib/rate-limit";
import { jsonRefusal } from "@/app/_lib/api-response";
import { withRetryAfter } from "@/app/_lib/throttle-response";
import { isThrottled, recordFailedAttempt, clearFailures, throttleRetryAfterMs, type ThrottleOpts } from "@/app/_lib/auth/login-throttle";
import { BODY_TOO_LARGE, readJsonWithLimit } from "@/app/_lib/request-body";

// Brute-force / credential-stuffing throttle (bug-ui-scan-2026-07-09 #4). Fixed
// 15-minute window, persisted per-account AND per-IP (see login-throttle.ts). The
// per-ACCOUNT bucket is the primary defense: a targeted account is protected even
// when the attacker rotates source IPs. The per-IP bucket is a coarser cap (higher
// limit — a shared corporate NAT is many legit users) that bounds a single host
// spraying many accounts.
//
// WHY THE IP BUCKET IS CONDITIONAL (scan-sweep 2026-08-21): with KP_TRUSTED_PROXY
// unset — the default for a directly-exposed self-host — clientIpFrom() has no
// socket peer address to read and returns SHARED_CLIENT_KEY for EVERY request, so
// `login:ip:local` is ONE bucket for the whole internet. At limit 20 that is a
// deployment-wide denial of service: twenty anonymous POSTs lock every user out
// for 15 minutes, and because the throttle is checked BEFORE verifyCredentials no
// correct password can ever reach clearFailures to release it. Indefinitely
// re-triggerable by an unauthenticated caller. Skipping the degenerate bucket
// costs nothing an attacker was not already free to do: the ACCOUNT bucket is the
// real defense and IP-spoofing cannot evade it, which is exactly why it exists.
const LOGIN_WINDOW_MS = 15 * 60_000;
const ACCOUNT_THROTTLE: ThrottleOpts = { limit: 5, windowMs: LOGIN_WINDOW_MS };
const IP_THROTTLE: ThrottleOpts = { limit: 20, windowMs: LOGIN_WINDOW_MS };
const OPERATOR_THROTTLE: ThrottleOpts = { limit: 10, windowMs: LOGIN_WINDOW_MS };

// Constant-time compare via fixed-length sha256 digests (no length-leak, no early
// return) — the operator password is the only secret on that path.
function constantTimeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** 429 + Retry-After delta-seconds from the persisted window. `otherKey` is the
 *  IP bucket on the per-user path: remaining is the longer of the tripped
 *  windows, capped at this caller's window. The clamp itself (round up, never 0,
 *  no header without a figure) is the shared one in throttle-response.ts. */
function throttledRefusal(key: string, opts: ThrottleOpts, otherKey?: string | null, otherOpts?: ThrottleOpts): NextResponse {
  const res = jsonRefusal("TOO_MANY_REQUESTS", 429);
  const remainingMs = Math.max(
    throttleRetryAfterMs(key, opts) ?? 0,
    otherKey && otherOpts ? (throttleRetryAfterMs(otherKey, otherOpts) ?? 0) : 0,
  );
  return withRetryAfter(res, remainingMs, opts.windowMs);
}

// Every mint below goes through auth/session-issuer.ts, which owns the cookie pair
// (the session + the readable "entered the workspace" marker, one attribute set) and
// re-checks the principal against the database. This door only decides WHO signed in.

// Auth foundation. Two login paths on one endpoint:
//   • Per-user (P0): { email, password } → an identity-carrying session scoped to
//     the user's first team. Independent of KP_OPERATOR_PASSWORD (a real user is
//     its own credential).
//   • Operator (legacy): { password } → the single-shared-password session. Opt-in;
//     503 when KP_OPERATOR_PASSWORD is unset (nothing to log into).
/** Hard cap on this public door's request body: an email and a password, on the one door reachable before any credential is proven.
 *  Enforced on the BYTES READ, not on the caller's content-length (request-body.ts). */
const MAX_LOGIN_BODY_BYTES = 8 * 1024;

export async function POST(request: Request) {
  const body = await readJsonWithLimit<{ email?: unknown; password?: unknown }>(request, MAX_LOGIN_BODY_BYTES, {});
  if (body === BODY_TOO_LARGE) return jsonRefusal("PAYLOAD_TOO_LARGE", 413, { maxBytes: MAX_LOGIN_BODY_BYTES });
  const password = typeof body.password === "string" ? body.password : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";

  const ip = clientIpFrom(request.headers);

  if (email) {
    // Throttle keyed on BOTH the account and the source IP. Refuse (429) before the
    // credential check so a tripped bucket also sheds the scrypt cost (a cheap DoS
    // otherwise). Keying on the normalized email means "Foo@x" and "foo@x" share one
    // bucket, matching verifyCredentials' own normalization.
    const acctKey = `login:acct:${normalizeEmail(email)}`;
    const ipKey = `login:ip:${ip}`;
    // Only consult the IP bucket when the IP is a real per-client identity (see the
    // header note): a shared key would make this one global lockout.
    const perClientIp = ip !== SHARED_CLIENT_KEY;
    if (isThrottled(acctKey, ACCOUNT_THROTTLE) || (perClientIp && isThrottled(ipKey, IP_THROTTLE))) {
      return throttledRefusal(acctKey, ACCOUNT_THROTTLE, perClientIp ? ipKey : null, IP_THROTTLE);
    }
    // Uniform 401 for both "no such user" and "wrong password" — never leak which.
    const user = password ? verifyCredentials(email, password) : null;
    if (!user) {
      // Count the miss against both buckets, uniformly whether or not the email
      // exists — so the 429 can never become a user-existence oracle.
      recordFailedAttempt(acctKey, ACCOUNT_THROTTLE);
      if (perClientIp) recordFailedAttempt(ipKey, IP_THROTTLE);
      return jsonRefusal("LOGIN_CREDENTIALS_INVALID", 401);
    }
    // Success frees both buckets so a legitimate user is never held back by their
    // own earlier typos (and a good login is evidence the IP has real users on it).
    clearFailures(acctKey);
    clearFailures(ipKey);
    // Land the user on their first team (by created_at) inside their OWN org, with that
    // role. A user with no team yet lands on their own org's first team with no role
    // (read-gated); it used to be the install's home workspace whatever the user's org.
    // An org with no team at all has nowhere to land: the same uniform 401 as a disabled
    // account (verifyCredentials' posture: the door never says which non-candidate).
    const landing = landingWorkspaceFor(user.id);
    const res = NextResponse.json({ ok: true });
    if (!landing || !issueSession(res, { kind: "user", userId: user.id, workspaceId: landing }).ok) {
      return jsonRefusal("LOGIN_CREDENTIALS_INVALID", 401);
    }
    return res;
  }

  const expected = process.env.KP_OPERATOR_PASSWORD;
  if (!expected) {
    // Open mode: the app runs open by design (proxy.ts allows every route). There
    // is no password to check, so "signing in" is just entering the workspace —
    // it flips the '/' landing→dashboard gate, not a security boundary. Set the
    // entry marker; also mint a real session when KP_SECRET is configured (keeps
    // identity-scoped features working), but bare dev without KP_SECRET (signSession
    // throws) still enters on the marker alone.
    const res = NextResponse.json({ ok: true, open: true });
    try {
      issueSession(res, { kind: "open" });
      return res;
    } catch {
      return markEntered(res);
    }
  }
  // Operator path has one shared secret, so a simpler per-IP throttle (no account
  // dimension). Same fixed window; refuse before the constant-time compare.
  //
  // NOT made conditional the way the user path above is, deliberately. There is no
  // account bucket behind this one, so skipping it on a shared client key would
  // leave the operator password with NO throttle at all — unlimited online guessing
  // at the only secret that grants owner capability. A shared bucket here is the
  // right trade: a 15-minute lockout an attacker can re-trigger is worse for
  // availability than the status quo, but strictly better than handing them
  // unbounded attempts at the credential itself. The real fix is KP_TRUSTED_PROXY
  // (which makes the key per-client) or per-user operator accounts, not a wider gate.
  const opKey = `login:op:${ip}`;
  if (isThrottled(opKey, OPERATOR_THROTTLE)) {
    return throttledRefusal(opKey, OPERATOR_THROTTLE);
  }
  if (!password || !constantTimeEqual(password, expected)) {
    recordFailedAttempt(opKey, OPERATOR_THROTTLE);
    return jsonRefusal("LOGIN_CREDENTIALS_INVALID", 401);
  }
  clearFailures(opKey);
  // `op: true` marks the operator session EXPLICITLY. resolveCaller() used to infer
  // "operator" from a missing `sub`, which meant any claim-less cookie carried owner
  // capabilities. This is the only place that privilege is granted.
  const res = NextResponse.json({ ok: true });
  issueSession(res, { kind: "operator" });
  return res;
}
