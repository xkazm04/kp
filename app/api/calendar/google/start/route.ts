import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { googleConsentUrl, googleOAuthConfig } from "@/app/_lib/calendar/google-oauth";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { jsonRefusal } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";

// W1.4 — begin the Google Calendar authorization.
//
// OPERATOR-only, like the ATS credential routes: this grants kp ongoing access to a real
// person's calendar, and the resulting refresh token does not expire.

/** The CSRF state cookie. Short-lived — a consent round trip is seconds, not hours, and a
 *  long-lived state is a longer window for a forged callback to land. */
export const OAUTH_STATE_COOKIE = "kp_gcal_state";
/** The cookie's Path, scoped to this integration's routes. Exported because a cookie is
 *  identified by (name, path): the callback's one-shot delete MUST repeat this path or the
 *  browser is told to expire a different, non-existent `kp_gcal_state` at "/" (the default
 *  Next fills in) and keeps this one until its TTL. */
export const OAUTH_STATE_COOKIE_PATH = "/api/calendar/google";
const STATE_TTL_SECONDS = 600;

// The other door on this tab that reaches the network, and it had no bound either.
// Every hit mints a 32-byte state, SETS A COOKIE and redirects a browser into Google's
// consent screen — so an unthrottled loop is both a cookie-churn/DoS surface on kp and
// unattributed traffic aimed at Google's endpoint from this deployment's address. The
// operator gate above is a documented no-op in open mode, so this is the real bound.
// 30/10min per IP: a consent round trip is seconds, and an operator who mis-registers
// the redirect URI legitimately retries a handful of times.
const OAUTH_START_RATE_LIMIT = { limit: 30, windowMs: 10 * 60_000 };

export async function GET(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  // AFTER the operator gate, and before the state mint + Set-Cookie, so a refused
  // caller never spends the budget and a throttled one never gets a stale state cookie.
  if (!rateLimit(`gcal-oauth-start:${clientIpFrom(request.headers)}`, OAUTH_START_RATE_LIMIT)) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }

  const base = publicBaseUrl(null);
  const config = googleOAuthConfig(base);
  if (!config) {
    // A precise, actionable 503 rather than a redirect into a Google error page: the fix
    // is two env vars, and the operator should be told that rather than left reading
    // Google's "invalid client" screen.
    return NextResponse.json(
      {
        error: "Google Calendar is not configured on this deployment.",
        needed: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"],
        redirectUriToRegister: `${base.replace(/\/+$/, "")}/api/calendar/google/callback`,
      },
      { status: 503 }
    );
  }

  // 32 random bytes, held in an httpOnly cookie and echoed by Google. The callback refuses
  // a mismatch, so a forged callback cannot bind an attacker's calendar to this workspace.
  const state = randomBytes(32).toString("base64url");
  const jar = await cookies();
  jar.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax", // must survive the top-level redirect back from Google
    secure: base.startsWith("https://"),
    path: OAUTH_STATE_COOKIE_PATH,
    maxAge: STATE_TTL_SECONDS,
  });
  return NextResponse.redirect(googleConsentUrl(config, state));
}
