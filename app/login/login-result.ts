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
