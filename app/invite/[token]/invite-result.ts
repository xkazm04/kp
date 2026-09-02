// Pure invite-response classifier, extracted from AcceptForm.tsx so the
// multi-outcome mapping is unit-testable under `node --test` (the .tsx itself
// can't load there — JSX + hooks need a bundler/DOM). Same shape, and the same
// reason, as ../login/login-result.ts.
//
// Before this existed the invite door had TWO outcomes. The preview GET mapped
// every non-ok response (and every fetch-level failure) to `{ valid: false }`,
// which renders "This link is invalid, already used, or expired. Ask an admin to
// send a new one." — so a colleague throttled by the door's own 10/min limiter,
// or one whose train went through a tunnel, was told their invitation was DEAD
// and sent to ask for a new link that would behave exactly the same. The redeem
// POST had the mirror bug: a 410 (the invite really did lapse between preview
// and submit) surfaced as the generic "Couldn't accept the invite", i.e. a
// retryable-sounding line over a permanently closed door.
//
// The route contract this maps (app/api/invite/[token]/route.ts):
//   GET   200 · 404 (no redeemable invite) · 429 (rate limited)
//   POST  200 · 400 weak_password · 409 email_taken|already_active ·
//         410 (not found / expired / already redeemed) · 429
// plus the two fetch-level failures (network drop, AbortController timeout).

export type InviteOutcome =
  | "ok" // 2xx — the preview loaded, or the redeem succeeded
  | "dead" // 404 / 410 — the LINK is gone. Nothing here is retryable.
  | "rateLimited" // 429 — the invite is fine; this device asked too often
  | "retry" // 5xx / network / timeout — our side, or the wire. The invite is still valid.
  | "weakPassword" // 400 weak_password — the submitted password is too short
  | "emailTaken" // 409 email_taken
  | "alreadyActive"; // 409 already_active

/** A server response (its HTTP status, plus the redeem path's stable `error`
 *  reason when one was sent) OR a fetch-level failure with no response.
 *  `timeout` and `network` are kept apart at the CALL SITE (the abort controller
 *  knows which fired) even though both classify as `retry`: the distinction is
 *  real, but the honest thing to tell an invitee is identical for both, and one
 *  fewer near-duplicate string is one fewer thing to translate four times. */
export type InviteFetchResult = { status: number; error?: string | null } | { failure: "network" | "timeout" };

export function classifyInviteResult(result: InviteFetchResult): InviteOutcome {
  if ("failure" in result) return "retry";
  const { status, error } = result;
  if (status >= 200 && status < 300) return "ok";
  // 429 FIRST: the limiter answers before the token is even looked up, so a
  // throttled request tells us nothing about whether the invite still exists.
  if (status === 429) return "rateLimited";
  // The only two statuses that mean the link itself is gone. 404 = the GET found
  // no redeemable invite; 410 = the POST found it consumed/expired/absent.
  if (status === 404 || status === 410) return "dead";
  if (status >= 500) return "retry";
  // 400 / 409 carry a stable reason code from acceptInvite. Each is a decision
  // about the SUBMISSION, not about the link.
  if (error === "weak_password") return "weakPassword";
  if (error === "email_taken") return "emailTaken";
  if (error === "already_active") return "alreadyActive";
  // An unexpected 4xx with no code we know: never claim the invitation is dead
  // (only 404/410 may say that) — offer the retry, which costs the invitee one
  // click and can't strand them on a false dead end.
  return "retry";
}

/** Outcomes the invitee can act on by trying again. `dead` deliberately is not
 *  one: a retry button over a consumed invite is a loop with no exit. */
export function isRetryableInviteOutcome(outcome: InviteOutcome): boolean {
  return outcome === "retry" || outcome === "rateLimited";
}
