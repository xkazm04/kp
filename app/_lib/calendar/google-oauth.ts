// W1.4 — Google OAuth for calendar access. The URL/param/state logic is here and pure
// enough to test without a Google account; the network calls are thin wrappers around it.
//
// WHY DIRECT OAUTH AND NOT NYLAS/CRONOFY (D2): a calendar aggregator becomes a
// subprocessor that sees every candidate's interview times and every recruiter's private
// calendar. kp's trust page lists its subprocessors and claims every one is optional; a
// mandatory PII intermediary for a core feature would make that claim false. Direct OAuth
// costs one more integration and keeps the list short.
//
// SCOPES — deliberately the two NARROW ones, not `calendar` or `calendar.readonly`:
//   calendar.freebusy — "is this person busy at 10:00" and nothing else. No titles, no
//                       attendees, no locations. kp needs to know THAT you are busy,
//                       never WHY, and a scope that cannot read the why is a stronger
//                       guarantee than a promise not to look.
//   calendar.events   — create/update the interview event we book. Required to write.
// Widening these is a trust-surface change, not a convenience: see docs + /trust.

export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/calendar.events",
] as const;

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/** The callback path. Registered verbatim in the Google Cloud OAuth client's authorized
 *  redirect URIs — Google matches it exactly, including scheme, host, port and path. */
export const GOOGLE_OAUTH_CALLBACK_PATH = "/api/calendar/google/callback";

export class GoogleOAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleOAuthError";
  }
}

export type GoogleOAuthConfig = { clientId: string; clientSecret: string; redirectUri: string };

/** Read the configured client, or null when this deployment has no Google integration.
 *  Null is a legitimate state — the whole feature is optional — so callers branch on it
 *  rather than treating it as an error. */
export function googleOAuthConfig(baseUrl: string, env: NodeJS.ProcessEnv = process.env): GoogleOAuthConfig | null {
  const clientId = (env.GOOGLE_OAUTH_CLIENT_ID ?? "").trim();
  const clientSecret = (env.GOOGLE_OAUTH_CLIENT_SECRET ?? "").trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri: `${baseUrl.replace(/\/+$/, "")}${GOOGLE_OAUTH_CALLBACK_PATH}` };
}

/**
 * The consent URL to send an operator to.
 *
 * `access_type=offline` + `prompt=consent` are both required and both deliberate: without
 * offline access Google returns no refresh token, and without forcing the prompt it
 * returns one only on the FIRST ever authorization — so a re-connect after a disconnect
 * would silently yield an access token that expires in an hour and never comes back. That
 * failure mode looks like "it worked, then stopped working tomorrow".
 *
 * `include_granted_scopes=false`: we ask for exactly our two scopes and do not inherit
 * whatever else this Google account has previously granted to this client.
 */
export function googleConsentUrl(config: GoogleOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: GOOGLE_CALENDAR_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export type GoogleTokens = {
  accessToken: string;
  /** Absent when Google withholds one — see googleConsentUrl for why that must not happen. */
  refreshToken: string | null;
  expiresAt: string;
  scopes: string[];
};

/** Parse a Google token response into our shape, rejecting the responses that would leave
 *  a half-connected integration behind. */
export function parseTokenResponse(payload: unknown, nowMs: number = Date.now()): GoogleTokens {
  if (!payload || typeof payload !== "object") throw new GoogleOAuthError("token response was not an object.");
  const o = payload as Record<string, unknown>;
  if (typeof o.error === "string") {
    throw new GoogleOAuthError(`Google refused the token exchange: ${o.error}${o.error_description ? ` (${String(o.error_description)})` : ""}`);
  }
  const accessToken = typeof o.access_token === "string" ? o.access_token.trim() : "";
  if (!accessToken) throw new GoogleOAuthError("token response carried no access_token.");
  const expiresIn = typeof o.expires_in === "number" && Number.isFinite(o.expires_in) ? o.expires_in : 3600;
  const scopes = typeof o.scope === "string" ? o.scope.split(/\s+/).filter(Boolean) : [];
  return {
    accessToken,
    refreshToken: typeof o.refresh_token === "string" && o.refresh_token.trim() ? o.refresh_token.trim() : null,
    expiresAt: new Date(nowMs + expiresIn * 1000).toISOString(),
    scopes,
  };
}

/** True when the stored access token is close enough to expiry that a call should refresh
 *  first. The 2-minute skew covers clock drift and the round trip itself — a token that
 *  expires mid-request produces a confusing 401 rather than a clean refresh. */
export function accessTokenExpired(expiresAt: string | null, nowMs: number = Date.now(), skewMs = 120_000): boolean {
  if (!expiresAt) return true;
  const ms = Date.parse(expiresAt);
  return Number.isNaN(ms) || ms - skewMs <= nowMs;
}

/** Did the grant actually include everything we asked for? Google lets a user untick
 *  individual scopes on the consent screen, which yields a "successful" connection that
 *  cannot read free/busy or cannot write the event — a failure worth naming at connect
 *  time rather than discovering when a booking silently does nothing. */
export function missingScopes(granted: readonly string[]): string[] {
  return GOOGLE_CALENDAR_SCOPES.filter((s) => !granted.includes(s));
}

async function postForm(url: string, body: URLSearchParams): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await res.text();
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new GoogleOAuthError(`Google returned a non-JSON response (HTTP ${res.status}).`);
  }
  return payload;
}

/** Exchange the one-time authorization code for tokens. */
export async function exchangeCode(config: GoogleOAuthConfig, code: string): Promise<GoogleTokens> {
  return parseTokenResponse(
    await postForm(
      TOKEN_ENDPOINT,
      new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: "authorization_code",
      })
    )
  );
}

/** Trade the stored refresh token for a fresh access token. Google does NOT return a new
 *  refresh token here, so the caller keeps the one it has. */
export async function refreshAccessToken(config: GoogleOAuthConfig, refreshToken: string): Promise<GoogleTokens> {
  const tokens = parseTokenResponse(
    await postForm(
      TOKEN_ENDPOINT,
      new URLSearchParams({
        refresh_token: refreshToken,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: "refresh_token",
      })
    )
  );
  return { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken };
}

/** Best-effort revoke, so disconnecting in kp actually withdraws the grant at Google
 *  rather than merely forgetting the token on our side. */
export async function revokeToken(token: string): Promise<boolean> {
  try {
    const res = await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" });
    return res.ok;
  } catch {
    return false;
  }
}
