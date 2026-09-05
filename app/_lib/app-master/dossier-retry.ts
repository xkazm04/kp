// How the App-master client re-posts a finished scan's dossier after the intake
// route REFUSES it, and what the card is allowed to say while it waits.
//
// Two refusals reach that POST (app/api/intake/[id]/dossier/route.ts) and both
// used to be rendered as a lie:
//
//   * **429** (the route's 20-per-10-minutes limiter, line 53) fell into the
//     watcher's catch and set `scanState = "unreachable"` — "the scan is
//     unreachable" under an intake that is perfectly reachable, which sends the
//     requestor off to re-scan a repository for nothing.
//   * **409 INTAKE_BRIEF_MOVED** (the compare-and-swap at line 82) returned
//     silently, so the state line said nothing AND the next tasks tick re-posted
//     immediately — each attempt paying a full Python spawn before the CAS
//     refuses it again.
//
// So: every refusal gets a state the card can render, and a WAIT before the next
// attempt. Pure and free of React, so `dossier-retry.test.ts` pins the ladder
// without a DOM.

/** How many POSTs one scan's dossier is worth before the client stops asking.
 *  A 409 that repeats five times is not a race any more, it is a brief that is
 *  being edited continuously; a sixth spawn buys nothing. */
export const DOSSIER_POST_MAX_ATTEMPTS = 5;

/** The first wait, doubled per attempt up to `DOSSIER_POST_MAX_DELAY_MS`. */
export const DOSSIER_POST_BASE_DELAY_MS = 2_000;
export const DOSSIER_POST_MAX_DELAY_MS = 60_000;

/** The limiter's own window (route line 53). The fallback when the response
 *  carries no `Retry-After`: waiting less than the window just spends another
 *  attempt on a door that is still shut. */
export const DOSSIER_THROTTLE_WINDOW_MS = 10 * 60_000;

/** What the POST came back as. `unreachable` covers both a transport failure and
 *  any other non-2xx: neither tells the client anything it can act on. */
export type DossierPostOutcome =
  | { kind: "throttled"; retryAfterMs: number | null }
  | { kind: "conflict" }
  | { kind: "unreachable" };

/** The two states this module ADDS to `ScanState` (jdsIntakeLogic.ts). Both are
 *  also message keys under `library.tab.intake.appMaster.scan.*`, like every
 *  other member of that union, so a state with no catalog entry is a tsc error. */
export type DossierRetryState = "throttled" | "rereading";

export type DossierRetryPlan = {
  /** What the card says now. Never `unreachable` for a 429 or a 409. */
  state: DossierRetryState | "unreachable";
  /** Milliseconds before the next POST is allowed. `0` when there will not be one. */
  waitMs: number;
  /** `false` = the ladder is spent; the state above stays on screen. */
  retry: boolean;
};

/** Exponential, capped. `attempt` is 1-based and counts the POST that just failed. */
export function dossierBackoffMs(attempt: number): number {
  const n = Math.max(1, Math.floor(attempt));
  // 2^30 ms already dwarfs the cap; clamping the exponent keeps the shift finite
  // for an attempt counter that somehow ran away.
  const grown = DOSSIER_POST_BASE_DELAY_MS * 2 ** Math.min(n - 1, 20);
  return Math.min(grown, DOSSIER_POST_MAX_DELAY_MS);
}

/** Read a `Retry-After` header as milliseconds. Delta-seconds only: an HTTP-date
 *  depends on the client's clock agreeing with the server's, and a wrong clock
 *  would turn a 30-second wait into a 10-hour one. `null` = no usable value, and
 *  the caller falls back to the limiter window. */
export function retryAfterMsFrom(header: string | null | undefined): number | null {
  if (typeof header !== "string") return null;
  const raw = header.trim();
  // `Number("")` is 0, so an absent-but-present header would otherwise read as
  // "retry immediately" — the one answer a throttled client must not give.
  if (raw === "") return null;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(seconds * 1_000, DOSSIER_THROTTLE_WINDOW_MS);
}

export function planDossierRetry(outcome: DossierPostOutcome, attempt: number): DossierRetryPlan {
  const state: DossierRetryPlan["state"] =
    outcome.kind === "throttled" ? "throttled" : outcome.kind === "conflict" ? "rereading" : "unreachable";
  const retry = attempt < DOSSIER_POST_MAX_ATTEMPTS;
  if (!retry) return { state, waitMs: 0, retry: false };
  const backoff = dossierBackoffMs(attempt);
  const waitMs =
    outcome.kind === "throttled"
      ? // The limiter said when, or the window says when — whichever is longer
        // than the ladder we would otherwise have used.
        Math.max(outcome.retryAfterMs ?? DOSSIER_THROTTLE_WINDOW_MS, backoff)
      : backoff;
  return { state, waitMs, retry: true };
}
