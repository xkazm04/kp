import { NextResponse } from "next/server";
import type { Capability } from "./auth/roles";
import type { Refusal } from "./refusal";
import { STORE_ERRORS, type StoreErrorCode } from "./api-errors/store-errors";
import { REFUSAL_ERRORS, type RefusalErrorCode } from "./api-errors/refusal-errors";

// Shared JSON envelopes for route handlers. The error-shaping ternary
// `error instanceof Error ? error.message : "…"` was hand-rolled in dozens of
// route files; centralizing it gives every catch block ONE consistent `{ error }`
// envelope and a single place to later redact internal messages or add logging.
// Adopted first in the Scheduling & Offers routes as the pattern entry point.

/** Error envelope: `{ error }` at `status` (default 500). Pulls `.message` off a
 *  thrown Error, else falls back to `fallback` — so a non-Error throw never leaks
 *  `[object Object]`/`undefined` to the client. */
export function jsonError(err: unknown, fallback: string, status = 500): NextResponse {
  const message = err instanceof Error ? err.message : fallback;
  return NextResponse.json({ error: message }, { status });
}

/** Success envelope: the payload as-is, status 200 by default. */
export function jsonOk<T>(body: T, status = 200): NextResponse {
  return NextResponse.json(body, { status });
}

// The two code catalogs live in app/_lib/api-errors/ (data, high churn); re-exported so every
// importer of this module compiles unchanged. The helpers below are the small, stable part.
export { STORE_ERRORS, REFUSAL_ERRORS };
export type { StoreErrorCode, RefusalErrorCode };


/** Refusal envelope: the canonical English plus its code, at `status`. Unlike
 *  safeJsonError this logs nothing — a refusal is an expected outcome, not a
 *  fault, and logging every closed posting would be noise. */
export function jsonRefusal(code: RefusalErrorCode, status: number, extra?: Record<string, unknown>): NextResponse {
  // `extra` is DATA the reader's own sentence needs and English prose used to
  // smuggle: the note cap, the step ids a board actually has, the occupied steps a
  // migration left unmapped. It rides beside the code so the client can render a
  // localized message WITH the numbers, instead of painting the server's string.
  return NextResponse.json({ error: REFUSAL_ERRORS[code], code, ...extra }, { status });
}

/** Capability gate for a write door, with a CODED refusal.
 *
 *  The base `requireCapability` gate in app/_lib/auth/current-user.ts answers
 *  a bare 403. The org and workspace gates now code their own 403s. This
 *  wrapper re-shapes a bare 403 into
 *  FORBIDDEN_CAPABILITY plus the capability as data; 401 (no session) and 404 (a
 *  cross-org probe, from the workspace gate) pass through untouched, because
 *  neither is a capability answer.
 *
 *  Usage — the gate is passed in rather than imported here on purpose: this module
 *  is the pure response vocabulary and must not pull the DB-backed auth layer into
 *  every route that only wants an envelope.
 *
 *      const denied = await requireCapabilityCoded("pipeline:write", requireCapability);
 *      if (denied) return denied;
 */
export async function requireCapabilityCoded(
  capability: Capability,
  gate: (cap: Capability) => Promise<NextResponse | null>,
): Promise<NextResponse | null> {
  const denied = await gate(capability);
  if (!denied || denied.status !== 403) return denied;
  return jsonRefusal("FORBIDDEN_CAPABILITY", 403, { capability });
}

/** Safe 500 responder for store-backed handlers. Logs the full error server-side
 *  under `[route] CODE`, then returns `{ error: <generic message>, code }` — the
 *  raw `err.message` (and any SQLite/filesystem detail in it) never crosses the
 *  wire. `route` is a short tag for the server log only, e.g. "api:jds". */
export function safeJsonError(err: unknown, route: string, code: StoreErrorCode, status = 500): NextResponse {
  console.error(`[${route}] ${code}`, err);
  return NextResponse.json({ error: STORE_ERRORS[code], code }, { status });
}

/** A thrown Refusal (app/_lib/refusal.ts) answers as jsonRefusal, its detail logged at
 *  info and kept off the wire; anything else as safeJsonError. Refusals are recognised by
 *  their registry-symbol brand: importing refusal.ts here would put it on every route. */
export function answerFailure(err: unknown, route: string, storeCode: StoreErrorCode, status = 500): NextResponse {
  if (err instanceof Error && (err as unknown as Record<symbol, unknown>)[Symbol.for("kp.refusal")] === true) {
    const r = err as Refusal;
    if (r.detail) console.info(`[${route}] refused (${r.code}): ${r.detail}`);
    return jsonRefusal(r.code, r.status, r.extra);
  }
  return safeJsonError(err, route, storeCode, status);
}
