import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { ENTERED_COOKIE, SESSION_COOKIE, SESSION_TTL_MS, signSession } from "@/app/_lib/auth/session";
import { verifyCredentials, normalizeEmail } from "@/app/_lib/db/users";
import { listMembershipsForUser } from "@/app/_lib/db/memberships";
import { DEFAULT_WORKSPACE_ID } from "@/app/_lib/db/workspaces";
import { clientIpFrom, SHARED_CLIENT_KEY } from "@/app/_lib/rate-limit";
import { jsonRefusal } from "@/app/_lib/api-response";
import { isThrottled, recordFailedAttempt, clearFailures, type ThrottleOpts } from "@/app/_lib/auth/login-throttle";

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

const COOKIE_MAX_AGE = Math.floor(SESSION_TTL_MS / 1000);

// The readable "entered the workspace" marker (see session.ts) — set on every
// successful sign-in so the '/' gate + theme script can distinguish an entered
// operator from an anonymous landing visitor. Not a credential; the session is.
function setEntered(res: NextResponse): NextResponse {
  res.cookies.set(ENTERED_COOKIE, "1", { httpOnly: false, secure: true, sameSite: "lax", path: "/", maxAge: COOKIE_MAX_AGE });
  return res;
}

function withSessionCookie(res: NextResponse, token: string): NextResponse {
  // __Host- requires Secure + Path=/ + no Domain. Secure is accepted on
  // http://localhost (a trustworthy origin), so this works in dev too.
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  return setEntered(res);
}

// Auth foundation. Two login paths on one endpoint:
//   • Per-user (P0): { email, password } → an identity-carrying session scoped to
//     the user's first team. Independent of KP_OPERATOR_PASSWORD (a real user is
//     its own credential).
//   • Operator (legacy): { password } → the single-shared-password session. Opt-in;
//     503 when KP_OPERATOR_PASSWORD is unset (nothing to log into).
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { email?: unknown; password?: unknown };
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
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    // Uniform 401 for both "no such user" and "wrong password" — never leak which.
    const user = password ? verifyCredentials(email, password) : null;
    if (!user) {
      // Count the miss against both buckets, uniformly whether or not the email
      // exists — so the 429 can never become a user-existence oracle.
      recordFailedAttempt(acctKey, ACCOUNT_THROTTLE);
      if (perClientIp) recordFailedAttempt(ipKey, IP_THROTTLE);
      return NextResponse.json({ error: "Incorrect email or password." }, { status: 401 });
    }
    // Success frees both buckets so a legitimate user is never held back by their
    // own earlier typos (and a good login is evidence the IP has real users on it).
    clearFailures(acctKey);
    clearFailures(ipKey);
    // Land the user on their first team (by created_at) with that role. A user with
    // no team yet falls back to the default workspace with no role (read-gated).
    const primary = listMembershipsForUser(user.id)[0];
    const token = signSession(primary?.workspaceId ?? DEFAULT_WORKSPACE_ID, Date.now(), {
      sub: user.id,
      org: user.orgId,
      role: primary?.role,
    });
    return withSessionCookie(NextResponse.json({ ok: true }), token);
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
      return withSessionCookie(res, signSession());
    } catch {
      return setEntered(res);
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
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  if (!password || !constantTimeEqual(password, expected)) {
    recordFailedAttempt(opKey, OPERATOR_THROTTLE);
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }
  clearFailures(opKey);
  // `op: true` marks the operator session EXPLICITLY. resolveCaller() used to infer
  // "operator" from a missing `sub`, which meant any claim-less cookie carried owner
  // capabilities. This is the only place that privilege is granted.
  return withSessionCookie(NextResponse.json({ ok: true }), signSession(undefined, Date.now(), { op: true }));
}
