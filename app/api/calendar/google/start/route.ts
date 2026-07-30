import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { googleConsentUrl, googleOAuthConfig } from "@/app/_lib/calendar/google-oauth";
import { requireOperator } from "@/app/_lib/auth/require-operator";

// W1.4 — begin the Google Calendar authorization.
//
// OPERATOR-only, like the ATS credential routes: this grants kp ongoing access to a real
// person's calendar, and the resulting refresh token does not expire.

/** The CSRF state cookie. Short-lived — a consent round trip is seconds, not hours, and a
 *  long-lived state is a longer window for a forged callback to land. */
export const OAUTH_STATE_COOKIE = "kp_gcal_state";
const STATE_TTL_SECONDS = 600;

export async function GET() {
  const denied = await requireOperator();
  if (denied) return denied;

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
    path: "/api/calendar/google",
    maxAge: STATE_TTL_SECONDS,
  });
  return NextResponse.redirect(googleConsentUrl(config, state));
}
