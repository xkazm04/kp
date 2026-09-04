import { NextResponse } from "next/server";
import { ENTERED_COOKIE, SESSION_COOKIE, SESSION_TTL_MS, signSession } from "@/app/_lib/auth/session";
import { registerAccount } from "@/app/_lib/signup-service";
import { signupEnabled } from "@/app/_lib/workspace-lock";
import { clientIpFrom } from "@/app/_lib/rate-limit";
import { jsonRefusal } from "@/app/_lib/api-response";
import { isThrottled, recordFailedAttempt, type ThrottleOpts } from "@/app/_lib/auth/login-throttle";
import { BODY_TOO_LARGE, readJsonWithLimit } from "@/app/_lib/request-body";

// Self-serve registration (the /login sibling): email + password → a brand-new
// org + team + owner membership (signup-service, one transaction) → signed in
// and landed on '/' where the first-run onboarding wizard fires (the new user
// has no onboarding stamp — onboarding-gate.needsOnboarding).
//
// GATED: KP_SIGNUP_ENABLED unset (the default) answers 404 as if the route
// didn't exist — same concealment posture as the fail-closed public-routes
// doctrine (an ungated deploy must not even advertise a signup surface while
// tenancy is incomplete). See workspace-lock.signupEnabled for the rationale.
//
// Abuse containment: the login route's PERSISTED throttle store (login-throttle,
// multi-process-safe), keyed per-IP. Unlike login, EVERY attempt counts —
// success included — because the side effect being bounded is tenant creation
// itself, not credential guessing. 10 registrations / 15 min / IP is generous
// for humans and cheap to raise.
const REGISTER_THROTTLE: ThrottleOpts = { limit: 10, windowMs: 15 * 60_000 };

const COOKIE_MAX_AGE = Math.floor(SESSION_TTL_MS / 1000);

/** Hard cap on this public door's request body: an email, a password, a display name and an org name, on an unauthenticated signup door.
 *  Enforced on the BYTES READ, not on the caller's content-length (request-body.ts). */
const MAX_REGISTER_BODY_BYTES = 8 * 1024;

export async function POST(request: Request) {
  if (!signupEnabled()) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const ip = clientIpFrom(request.headers);
  // Kept unconditional even though `ip` collapses to a shared key without
  // KP_TRUSTED_PROXY (see rate-limit.ts / the login route's header). Signup has no
  // per-account bucket behind it, so dropping the degenerate one would leave open
  // signup with no cap at all. A coarse global cap IS the right failure for abuse
  // containment; the login route's shared bucket was wrong only because it denied
  // service to existing users, which a full signup bucket does not do.
  const key = `register:ip:${ip}`;
  if (isThrottled(key, REGISTER_THROTTLE)) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  recordFailedAttempt(key, REGISTER_THROTTLE);

  const body = await readJsonWithLimit<{
    email?: unknown;
    password?: unknown;
    name?: unknown;
    orgName?: unknown;
  }>(request, MAX_REGISTER_BODY_BYTES, {});
  if (body === BODY_TOO_LARGE) return jsonRefusal("PAYLOAD_TOO_LARGE", 413, { maxBytes: MAX_REGISTER_BODY_BYTES });
  const result = registerAccount({
    email: typeof body.email === "string" ? body.email : "",
    password: typeof body.password === "string" ? body.password : "",
    name: typeof body.name === "string" ? body.name : null,
    orgName: typeof body.orgName === "string" ? body.orgName : null,
  });
  if (!result.ok) {
    // Machine reasons (the invite-accept contract): the client maps each to a
    // localized message. email_taken deliberately says nothing about the
    // account's status; the per-IP throttle bounds enumeration.
    const status = result.reason === "email_taken" ? 409 : 400;
    return NextResponse.json({ error: result.reason }, { status });
  }

  // Mint the session exactly like a successful email login: signed cookie with
  // identity claims for the new team + the readable "entered" marker that flips
  // the '/' landing→dashboard gate. Best-effort (invite-accept precedent): if
  // KP_SECRET is unset (open dev) the account is STILL created and the caller
  // lands on /login to sign in once a secret exists.
  const res = NextResponse.json({ ok: true });
  try {
    const token = signSession(result.workspaceId, Date.now(), {
      sub: result.user.id,
      org: result.orgId,
      role: result.role,
    });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: COOKIE_MAX_AGE,
    });
    res.cookies.set(ENTERED_COOKIE, "1", { httpOnly: false, secure: true, sameSite: "lax", path: "/", maxAge: COOKIE_MAX_AGE });
  } catch {
    /* KP_SECRET unavailable — account created, sign-in happens manually */
  }
  return res;
}
