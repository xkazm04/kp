import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GOOGLE_CALENDAR_SCOPES,
  GOOGLE_OAUTH_CALLBACK_PATH,
  GoogleOAuthError,
  accessTokenExpired,
  createPkceVerifier,
  decodeOAuthState,
  encodeOAuthState,
  exchangeCode,
  googleConsentUrl,
  googleOAuthConfig,
  missingScopes,
  parseTokenResponse,
  pkceChallenge,
  refreshAccessToken,
} from "./google-oauth.ts";

const CONFIG = { clientId: "cid.apps.googleusercontent.com", clientSecret: "secret", redirectUri: "https://kp.example/api/calendar/google/callback" };

test("config is absent (not an error) when the deployment has no Google integration", () => {
  // The whole feature is optional; callers branch on null rather than handling a throw.
  assert.equal(googleOAuthConfig("https://kp.example", {} as unknown as NodeJS.ProcessEnv), null);
  assert.equal(googleOAuthConfig("https://kp.example", { GOOGLE_OAUTH_CLIENT_ID: "x" } as unknown as NodeJS.ProcessEnv), null);
  assert.equal(googleOAuthConfig("https://kp.example", { GOOGLE_OAUTH_CLIENT_ID: " ", GOOGLE_OAUTH_CLIENT_SECRET: " " } as unknown as NodeJS.ProcessEnv), null);
});

test("the redirect URI is derived from the base URL and normalized", () => {
  // Google matches this string EXACTLY against the registered URI, so a stray trailing
  // slash on the base URL would silently break every connect attempt.
  const env = { GOOGLE_OAUTH_CLIENT_ID: "cid", GOOGLE_OAUTH_CLIENT_SECRET: "sec" } as unknown as NodeJS.ProcessEnv;
  assert.equal(googleOAuthConfig("https://kp.example", env)?.redirectUri, `https://kp.example${GOOGLE_OAUTH_CALLBACK_PATH}`);
  assert.equal(googleOAuthConfig("https://kp.example///", env)?.redirectUri, `https://kp.example${GOOGLE_OAUTH_CALLBACK_PATH}`);
});

test("the consent URL asks for offline access and forces the prompt", () => {
  // Both are required for a DURABLE connection. Without offline there is no refresh token
  // at all; without prompt=consent Google returns one only on the first-ever grant, so a
  // re-connect yields an access token that dies in an hour — "it worked, then stopped".
  const url = new URL(googleConsentUrl(CONFIG, "state123"));
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("state"), "state123");
  assert.equal(url.searchParams.get("redirect_uri"), CONFIG.redirectUri);
  assert.equal(url.searchParams.get("include_granted_scopes"), "false", "we take exactly our scopes, not whatever else was granted before");
});

test("the requested scopes are the two NARROW ones", () => {
  // freebusy cannot read titles or attendees — kp learns THAT you are busy, never WHY.
  // A scope that cannot see it beats a promise not to look, so widening this is a
  // trust-surface change and this test is the tripwire.
  const scope = new URL(googleConsentUrl(CONFIG, "s")).searchParams.get("scope")!.split(" ");
  assert.deepEqual(scope.sort(), [...GOOGLE_CALENDAR_SCOPES].sort());
  assert.equal(scope.includes("https://www.googleapis.com/auth/calendar"), false, "the full-calendar scope must never be requested");
  assert.equal(scope.includes("https://www.googleapis.com/auth/calendar.readonly"), false, "readonly would expose event titles");
});

test("a token response parses into our shape", () => {
  const t = parseTokenResponse({ access_token: "at", refresh_token: "rt", expires_in: 3600, scope: GOOGLE_CALENDAR_SCOPES.join(" ") }, 1_000_000);
  assert.equal(t.accessToken, "at");
  assert.equal(t.refreshToken, "rt");
  assert.equal(t.expiresAt, new Date(1_000_000 + 3_600_000).toISOString());
  assert.deepEqual(t.scopes, [...GOOGLE_CALENDAR_SCOPES]);
});

test("a refused or empty exchange throws rather than half-connecting", () => {
  assert.throws(() => parseTokenResponse({ error: "invalid_grant", error_description: "code expired" }), GoogleOAuthError);
  assert.throws(() => parseTokenResponse({ expires_in: 3600 }), GoogleOAuthError);
  assert.throws(() => parseTokenResponse({ access_token: "  " }), GoogleOAuthError);
  assert.throws(() => parseTokenResponse(null), GoogleOAuthError);
});

test("a missing refresh token is reported as null, not invented", () => {
  const t = parseTokenResponse({ access_token: "at", expires_in: 3600 });
  assert.equal(t.refreshToken, null);
});

test("expiry is judged with skew, so a token cannot die mid-request", () => {
  const now = 1_000_000;
  assert.equal(accessTokenExpired(new Date(now + 600_000).toISOString(), now), false);
  assert.equal(accessTokenExpired(new Date(now + 60_000).toISOString(), now), true, "inside the skew window counts as expired");
  assert.equal(accessTokenExpired(new Date(now - 1).toISOString(), now), true);
  assert.equal(accessTokenExpired(null, now), true);
  assert.equal(accessTokenExpired("not a date", now), true);
});

/** A blackholed endpoint: the connection is accepted and the response never comes. Only
 *  an abort ends the request — which is exactly the fact under test. */
function stubBlackholedGoogle(): { restore: () => void; sawSignal: () => boolean } {
  const real = globalThis.fetch;
  let sawSignal = false;
  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
    sawSignal = init?.signal instanceof AbortSignal;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  }) as typeof globalThis.fetch;
  return { restore: () => void (globalThis.fetch = real), sawSignal: () => sawSignal };
}

/** Settle `work` or report "hung" — never actually hang the suite on the pre-fix code. */
async function raceAgainstHang(work: Promise<unknown>): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hung = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve("hung"), 2000);
  });
  const outcome = await Promise.race([work.then(() => "resolved", (e: unknown) => `rejected:${(e as Error).name}`), hung]);
  clearTimeout(timer);
  return outcome;
}

test("a Google that never answers cannot hang the caller — the token calls are BOUNDED", async () => {
  // This is the one Google call on a PUBLIC path: /schedule/<token> proposes slots →
  // fetchBusy → accessTokenFor → refreshAccessToken. google-calendar.ts holds its own
  // calls to 8s; these held nothing, so a blackholed token endpoint (an egress firewall
  // that DROPs instead of RSTs is the everyday shape of this) left undici's 300s header
  // timeout as the only bound on a candidate's booking page.
  const stub = stubBlackholedGoogle();
  try {
    const exchanged = await raceAgainstHang(exchangeCode(CONFIG, "auth-code", { timeoutMs: 25 }));
    assert.equal(stub.sawSignal(), true, "the request must carry an abort signal");
    assert.notEqual(exchanged, "hung", "an unanswered Google must not hang the callback");
    assert.equal(exchanged, "rejected:GoogleOAuthError", "and it fails as our own error, not a raw AbortError");

    const refreshed = await raceAgainstHang(refreshAccessToken(CONFIG, "refresh-token", 25));
    assert.notEqual(refreshed, "hung", "nor the candidate's slot lookup, which refreshes first");
    assert.equal(refreshed, "rejected:GoogleOAuthError");
  } finally {
    stub.restore();
  }
});

test("a partial grant is detected at connect time", () => {
  // Google lets a user untick individual scopes, producing a "successful" connection that
  // silently cannot read free/busy or cannot write the event.
  assert.deepEqual(missingScopes([...GOOGLE_CALENDAR_SCOPES]), []);
  assert.deepEqual(missingScopes(["https://www.googleapis.com/auth/calendar.freebusy"]), [
    "https://www.googleapis.com/auth/calendar.events",
  ]);
  assert.equal(missingScopes([]).length, 2);
});

// PKCE (RFC 7636). Google recommends it for every client now, and this flow had none: an
// authorization code that leaked in transit (a referrer, a proxy log, an operator pasting
// a URL) was redeemable by whoever held it, for ongoing access to a real person's calendar.
test("the challenge is the S256 digest of the verifier — the RFC's own vector", () => {
  // RFC 7636 appendix B, so this pins the derivation against the spec rather than against
  // our own implementation restated.
  assert.equal(
    pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
  );
});

test("a minted verifier is base64url and long enough for the RFC", () => {
  const v = createPkceVerifier();
  assert.match(v, /^[A-Za-z0-9_-]+$/, "base64url only — no padding, nothing to escape in a cookie");
  assert.ok(v.length >= 43 && v.length <= 128, `43..128 chars, got ${v.length}`);
  assert.notEqual(createPkceVerifier(), v, "fresh per authorization");
  const challenge = pkceChallenge(v);
  assert.notEqual(challenge, v, "S256, never `plain` — a plain challenge IS the verifier");
  assert.match(challenge, /^[A-Za-z0-9_-]{43}$/);
});

test("the consent URL carries the challenge, and says which method", () => {
  const params = new URL(googleConsentUrl(CONFIG, "state123", "the-challenge")).searchParams;
  assert.equal(params.get("code_challenge"), "the-challenge");
  assert.equal(params.get("code_challenge_method"), "S256");
  // Absent when no challenge is offered — the pre-PKCE shape stays valid rather than
  // sending an empty challenge Google would reject.
  assert.equal(new URL(googleConsentUrl(CONFIG, "state123")).searchParams.get("code_challenge"), null);
});

test("the state cookie round-trips both halves, and tolerates a pre-PKCE one", () => {
  const state = "st-ate";
  const verifier = createPkceVerifier();
  assert.deepEqual(decodeOAuthState(encodeOAuthState(state, verifier)), { state, verifier });
  // A consent round trip already in flight when this deploys: no separator, no verifier —
  // and its authorization request carried no challenge either, so the exchange still works.
  assert.deepEqual(decodeOAuthState("legacy-state-value"), { state: "legacy-state-value", verifier: "" });
  assert.equal(decodeOAuthState(""), null);
  assert.equal(decodeOAuthState(null), null);
  assert.equal(decodeOAuthState(".only-a-verifier"), null, "a cookie with no state is not a state cookie");
});

test("the code exchange sends the verifier — and omits it when there is none", async () => {
  const real = globalThis.fetch;
  const sent: string[] = [];
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    sent.push(typeof init?.body === "string" ? init.body : "");
    return new Response(JSON.stringify({ access_token: "a", refresh_token: "r", expires_in: 3600, scope: "" }), { status: 200 });
  }) as typeof globalThis.fetch;
  try {
    await exchangeCode(CONFIG, "auth-code", { codeVerifier: "the-verifier" });
    assert.equal(new URLSearchParams(sent[0]).get("code_verifier"), "the-verifier");
    await exchangeCode(CONFIG, "auth-code", {});
    assert.equal(new URLSearchParams(sent[1]).get("code_verifier"), null);
  } finally {
    globalThis.fetch = real;
  }
});
