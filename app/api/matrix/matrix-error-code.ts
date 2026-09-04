// The failure vocabulary shared by the Fit Matrix's two routes — GET /api/matrix
// (the scored grid) and POST /api/match/reasoning (the per-cell "why this score").
//
// Both spawn Python behind `parseStderrError`, which ALREADY produces a machine
// `code` alongside the message and status — and both threw it away, answering a bare
// `{ error: err.message }`. Two consequences, both visible on screen: the client's
// `useErrorMessage` had no code to resolve, so every failure on the grid and in the
// popover rendered as the same generic sentence in the reader's language; and the
// reasoning route's 429 — the one failure whose remedy is simply "wait a minute" —
// was indistinguishable from an engine crash.
//
// Kept as a pure mapper (no NextResponse) so it is unit-testable: the routes
// themselves need a Next request scope the unit runner cannot give them.
import type { RefusalErrorCode, StoreErrorCode } from "@/app/_lib/api-response";

export type MatrixAnswer =
  /** A decision the caller can act on — answered with `jsonRefusal`, no server log. */
  | { kind: "refusal"; code: RefusalErrorCode }
  /** A fault whose real message (Python traceback, temp workdir path, provider stderr)
   *  must stay server-side — answered with `safeJsonError`. */
  | { kind: "store"; code: StoreErrorCode };

/** The pair of codes a surface falls back to when the runner's own code is not one the
 *  refusal registry knows. Separate per route so "the grid could not be built" and
 *  "that one match could not be explained" stay distinguishable to the reader. */
export type MatrixSurface = { invalid: RefusalErrorCode; failed: StoreErrorCode };

export const MATRIX_GRID_SURFACE: MatrixSurface = { invalid: "MATRIX_INPUT_INVALID", failed: "MATRIX_BUILD_FAILED" };
export const MATRIX_REASONING_SURFACE: MatrixSurface = { invalid: "MATCH_REASONING_UNAVAILABLE", failed: "MATCH_REASONING_FAILED" };
/** The candidate-focus ranking (POST /api/match) — the third route in this family and
 *  the one that was still forwarding `parseStderrError`'s raw stderr, i.e. match_cli's
 *  traceback and the temp workdir path, straight to the browser. Its own pair, not the
 *  grid's: "this candidate could not be ranked" and "the fit matrix could not be built"
 *  are different sentences on different screens. */
export const MATCH_RUN_SURFACE: MatrixSurface = { invalid: "MATCH_INPUT_INVALID", failed: "MATCH_RUN_FAILED" };

/** Runner codes that name a refusal the registry already carries, mapped onto it.
 *  `parseStderrError` derives `invalid_input` / `not_found` / `engine_error` from the
 *  status when a CLI emits no explicit code, but a CLI MAY emit its own — so the
 *  forwarding is a declared table rather than a blind pass-through of an untrusted
 *  string into `REFUSAL_ERRORS[code]`. */
const RUNNER_REFUSALS: Record<string, RefusalErrorCode> = {
  rate_limited: "TOO_MANY_REQUESTS",
  TOO_MANY_REQUESTS: "TOO_MANY_REQUESTS",
};

/** Decide how a matrix-side engine failure is answered. */
export function matrixEngineAnswer(err: { status: number; code?: string }, surface: MatrixSurface): MatrixAnswer {
  // The throttle first: a 429 is a refusal whatever the engine called it, and it is
  // the one failure where the reader's next move ("wait") differs from "try again".
  if (err.status === 429) return { kind: "refusal", code: "TOO_MANY_REQUESTS" };
  const forwarded = err.code ? RUNNER_REFUSALS[err.code] : undefined;
  if (forwarded) return { kind: "refusal", code: forwarded };
  // A 4xx is the caller's input, not a fault — its message is safe in principle, but
  // the code is what the client localizes, so it still goes through the registry.
  if (err.status >= 400 && err.status < 500) return { kind: "refusal", code: surface.invalid };
  return { kind: "store", code: surface.failed };
}
