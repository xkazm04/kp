// Pure login-response classifier extracted from LoginClient.tsx so the
// multi-outcome mapping is unit-testable under `node --test` (the .tsx itself
// can't load there — JSX + hooks need a bundler/DOM).
//
// bug-ui-scan-2026-07-09 (auth-sessions-workspace-tenancy #5): the login form
// used to collapse EVERY non-ok response into the inline "Incorrect email or
// password." message. A rate-limited (429) or server-error (5xx) user was told
// their password was wrong and sent into a guessing loop. A fetch that never
// resolves is a THIRD kind of failure — never a credential problem — and must
// re-enable the form rather than strand it in "submitting". This function maps
// the /api/auth/login server contract (200 · 401 · 429 · 5xx) plus the two
// fetch-level failures (network drop, AbortController timeout) to one honest
// outcome each; only `credential` is allowed to blame the password.

export type LoginOutcome =
  | "success" // 2xx — signed in, navigate away
  | "credential" // 401 — the ONLY case that shows the inline "wrong credentials" field error
  | "rateLimited" // 429 — "too many attempts" toast, form re-enabled
  | "serverError" // 5xx / any other unexpected non-ok — "service unavailable" toast
  | "network" // fetch rejected (offline / DNS) — "couldn't reach server" toast
  | "timeout"; // AbortController fired — "request timed out" toast

/** A server response (its HTTP status) OR a fetch-level failure with no response. */
export type LoginFetchResult = { status: number } | { failure: "network" | "timeout" };

export function classifyLoginResult(result: LoginFetchResult): LoginOutcome {
  if ("failure" in result) return result.failure;
  const { status } = result;
  if (status >= 200 && status < 300) return "success";
  if (status === 401) return "credential";
  if (status === 429) return "rateLimited";
  // 5xx and any other unexpected non-ok (400/403/…): never claim the password is
  // wrong — the server did not say 401.
  return "serverError";
}

/** Only the credential outcome shows the inline field error; every other
 *  non-success outcome toasts and re-enables the form. */
export function isInlineCredentialError(outcome: LoginOutcome): boolean {
  return outcome === "credential";
}

// --- Where a successful sign-in lands ---------------------------------------
//
// `?next=` is attacker-controllable (nothing in the app mints it; a phishing
// link can). The guard used to be a prefix test — `startsWith("/") &&
// !startsWith("//")` — which READS like an open-redirect check but is not one:
// `router.replace` resolves the value with the WHATWG URL parser, and that
// parser (a) treats a backslash as a slash for special schemes and (b) strips
// tab/CR/LF anywhere in the input. So `/\evil.com` and `/<TAB>/evil.com` both
// pass the prefix test and both parse to the AUTHORITY `evil.com`; Next then
// sees a foreign origin (isExternalURL) and hard-navigates the freshly
// signed-in operator to https://evil.com. Resolve with the SAME parser the
// router will use and require the same origin — a prefix test can never see
// what the parser does.
export function safeNextPath(search: string, origin: string): string {
  const raw = new URLSearchParams(search).get("next");
  // Only an in-app absolute path is ever a legitimate `next`; this also keeps the
  // check fail-closed in a document whose own origin is opaque ("null").
  if (!raw || !raw.startsWith("/")) return "/";
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return "/";
  }
  if (url.origin !== origin) return "/";
  return `${url.pathname}${url.search}${url.hash}`;
}
