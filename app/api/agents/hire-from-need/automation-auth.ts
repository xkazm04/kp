// Pure auth decision for the machine door onto hiring. Extracted from route.ts
// so the trust boundary is unit-tested directly (node --test cannot load the
// route — it drags in next/server + better-sqlite3). Import-free apart from the
// crypto compare it shares with `api/comms/callback/callback-auth.ts`.
//
// WHY A SECOND AUTH PATH AT ALL. Every other `/api/agents/*` route is gated by
// `requireOperator()` + a capability, both of which resolve a HUMAN session
// cookie. This door exists for Personas: an App master that notices one of its
// responsibilities has no holder POSTs here with no browser, no cookie and no
// person. The operator session stays valid here (a human may drive the same
// door), and the token is the alternative — never a replacement, and never a
// widening of any other route.
//
// The shape follows the delivery-callback precedent exactly, because it is the
// same problem: a shared secret presented by a machine.
//   - env var UNSET ⇒ the door is CLOSED and says so (503). It never defaults
//     open. A feature that hires agents and spends money must not be reachable
//     because nobody configured it.
//   - the token is read from a HEADER, never a query string, so it cannot land
//     in an access log, a proxy log or a Referer.
//   - the compare is CONSTANT TIME and LENGTH-INDEPENDENT, so a wrong guess
//     leaks neither where it diverged nor how long the real token is.

import { createHash, timingSafeEqual } from "node:crypto";

/** Env var holding the shared secret. Personas presents the same value from its
 *  own `KP_AUTOMATION_TOKEN`. */
export const AUTOMATION_TOKEN_ENV = "KP_AUTOMATION_TOKEN";

/** Header the token travels in. Never a query parameter. */
export const AUTOMATION_TOKEN_HEADER = "x-kp-automation-token";

/** Minimum length a configured token may have.
 *
 *  A four-character token compares in constant time and is still guessable, so
 *  the constant-time compare is not the whole defence. Refusing a short one at
 *  READ time — rather than at compare time — means a misconfiguration answers
 *  503 ("not enabled") instead of silently accepting a weak secret. */
export const MIN_AUTOMATION_TOKEN_CHARS = 24;

export type AutomationAuth =
  /** The env var is unset or too weak: the door is closed for everyone. */
  | { outcome: "disabled"; reason: string }
  /** A token was configured and the caller did not present a matching one. */
  | { outcome: "rejected" }
  /** The caller presented the configured token. */
  | { outcome: "accepted" };

/** Constant-time, length-independent secret comparison. `timingSafeEqual`
 *  requires equal-length buffers (and throws otherwise, itself leaking length),
 *  so both sides are hashed to a fixed 32-byte digest first. Returns false for a
 *  missing/empty presented value. */
export function tokensMatch(presented: string | null | undefined, expected: string): boolean {
  if (typeof presented !== "string" || presented.length === 0 || expected.length === 0) return false;
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Decide the machine door from the presented header and the process env.
 *
 *  `env` is a parameter rather than a direct `process.env` read so a test can
 *  drive every branch without mutating global state — the same reason
 *  `repo-scan-target.ts::allowedRoots` takes one. */
export function checkAutomationToken(
  presented: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env
): AutomationAuth {
  const configured = (env[AUTOMATION_TOKEN_ENV] ?? "").trim();
  if (!configured) {
    return {
      outcome: "disabled",
      reason: `Machine hiring is not enabled (set ${AUTOMATION_TOKEN_ENV}).`,
    };
  }
  if (configured.length < MIN_AUTOMATION_TOKEN_CHARS) {
    return {
      outcome: "disabled",
      reason: `${AUTOMATION_TOKEN_ENV} is set but shorter than ${MIN_AUTOMATION_TOKEN_CHARS} characters — refusing to accept a guessable token.`,
    };
  }
  return tokensMatch(presented, configured) ? { outcome: "accepted" } : { outcome: "rejected" };
}
