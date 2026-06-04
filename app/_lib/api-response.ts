import { NextResponse } from "next/server";

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
