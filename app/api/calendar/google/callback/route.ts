import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { exchangeCode, googleOAuthConfig, missingScopes } from "@/app/_lib/calendar/google-oauth";
import { saveCalendarConnection } from "@/app/_lib/calendar/token-store";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import type { CalendarCallbackStatus } from "@/app/_lib/calendar/callback-status";
import { OAUTH_STATE_COOKIE } from "../start/route";

// W1.4 — the OAuth callback. Verifies state, exchanges the code, stores the grant.
//
// Every failure path lands the operator back on the settings page with a `calendar=<code>`
// query param rather than showing a raw JSON error: this URL is reached by a browser
// redirect from Google, and a bare 400 body is a dead end for the person who was two
// clicks into connecting a calendar.

// connect-the-integrations: this now lands on the Integrations settings tab, which reads
// the code and renders the outcome. It previously pointed at ?tab=tasks, where nothing
// consumed the param — every outcome, success included, was a silent redirect.
const SETTINGS_PATH = "/?tab=integrations&calendar=";

// `code` is typed against the canonical vocabulary (callback-status.ts), so a new outcome
// cannot be redirected without also being added to the list the UI catalog is guarded on.
function back(base: string, code: CalendarCallbackStatus): NextResponse {
  return NextResponse.redirect(`${base.replace(/\/+$/, "")}${SETTINGS_PATH}${encodeURIComponent(code)}`);
}

/** Constant-time compare over equal-length buffers; length mismatch short-circuits (a
 *  length difference is not secret — the value is). */
function stateMatches(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export async function GET(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;

  const base = publicBaseUrl(null);
  const { searchParams } = new URL(request.url);
  const jar = await cookies();
  const expectedState = jar.get(OAUTH_STATE_COOKIE)?.value ?? "";
  // One-shot: clear it whatever happens, so a replayed callback cannot reuse it.
  jar.delete(OAUTH_STATE_COOKIE);

  // The user pressed "Cancel" on Google's consent screen. Not an error worth alarming
  // anyone about — say so plainly.
  const googleError = searchParams.get("error");
  if (googleError) return back(base, googleError === "access_denied" ? "cancelled" : "google_error");

  const state = searchParams.get("state") ?? "";
  if (!expectedState || !state || !stateMatches(expectedState, state)) {
    // Either a forged callback, or a genuine one that took longer than the state's TTL.
    return back(base, "state_mismatch");
  }

  const code = searchParams.get("code") ?? "";
  if (!code) return back(base, "no_code");

  const config = googleOAuthConfig(base);
  if (!config) return back(base, "not_configured");

  try {
    const tokens = await exchangeCode(config, code);
    if (!tokens.refreshToken) {
      // Without a refresh token the connection dies within the hour. Refusing to store it
      // is the honest move: a UI that says "connected" and stops working tomorrow is worse
      // than one that says the connect failed now.
      return back(base, "no_refresh_token");
    }
    const missing = missingScopes(tokens.scopes);
    saveCalendarConnection({ tokens, missingScopes: missing }, await currentWorkspace());
    // A partial grant IS stored — free/busy still works without the events scope — but the
    // operator is told, rather than discovering it when a booking silently writes nothing.
    return back(base, missing.length > 0 ? "connected_partial" : "connected");
  } catch (err) {
    console.error("[api/calendar/google/callback] token exchange failed", err);
    return back(base, "exchange_failed");
  }
}
