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

// --- Safe error hygiene for the SQLite-backed JD & template stores ----------
//
// A thrown better-sqlite3 / fs error carries raw internal detail in its
// `.message`: "SQLITE_CORRUPT", "UNIQUE constraint failed: jds.slug", the
// absolute db file path. Forwarding that to the client (which `jsonError` does)
// is an information-disclosure leak — the exact leak POST /api/jds hand-guards
// against while its siblings did not. `safeJsonError` closes that gap uniformly:
// it logs the full error server-side and returns ONLY a generic message plus a
// stable machine code, so every current and future JD/template endpoint is
// leak-safe by default. Use it — not `jsonError` — on any catch/500 path that
// can surface a store error. `jsonError` remains fine for routes whose messages
// are already client-safe (validation, business rules).

/** Single source of truth: each stable code paired with its GENERIC, client-safe
 *  message. The raw thrown error is logged server-side only and never reaches the
 *  client, so adding an endpoint means adding a code here — not re-deriving the
 *  safe pattern per route. */
export const STORE_ERRORS = {
  JD_LIST_FAILED: "Could not load the JD library. Please try again.",
  JD_LOAD_FAILED: "Could not load the JD. Please try again.",
  JD_SAVE_FAILED: "Could not save the JD. Please try again.",
  // Recruiter-side analyzed-candidates read (biz-ui scan 2026-06-12 #1).
  JD_ANALYSES_FAILED: "Could not load candidates for this JD. Please try again.",
  TEMPLATE_LIST_FAILED: "Could not load templates. Please try again.",
  TEMPLATE_LOAD_FAILED: "Could not load the template. Please try again.",
  TEMPLATE_CREATE_FAILED: "Could not save the template. Please try again.",
  TEMPLATE_UPDATE_FAILED: "Could not update the template. Please try again.",
  TEMPLATE_DELETE_FAILED: "Could not delete the template. Please try again.",
  // Voice-interview routes (idea-ab117371): their catch paths sit behind
  // better-sqlite3, the scorecard automation AND the provider adapters, whose
  // thrown errors embed upstream HTTP bodies — all internal detail.
  INTERVIEW_CREATE_FAILED: "Could not create the interview. Please try again.",
  INTERVIEW_CONNECT_FAILED: "Could not connect the voice call. Please try again.",
  INTERVIEW_COMPLETE_FAILED: "Could not save the interview. Please try again.",
  INTERVIEW_LOOKUP_FAILED: "Could not load interview data. Please try again.",
  INTERVIEW_PREP_FAILED: "Could not load interview prep. Please try again.",
  // Pipeline board routes (idea-66f52a3a): all sit directly on better-sqlite3.
  PIPELINE_LIST_FAILED: "Could not load the pipeline. Please try again.",
  PIPELINE_CREATE_FAILED: "Could not add to the pipeline. Please try again.",
  PIPELINE_ACTION_FAILED: "Could not apply that action. Please try again.",
  PIPELINE_EVENTS_FAILED: "Could not load recent activity. Please try again.",
  // Sourcing "reach out" (idea JOB3): sits on createPipelineEntry + the outreach
  // automation subprocess (Claude CLI), whose thrown errors embed internal detail.
  OUTREACH_FAILED: "Could not reach out to that candidate. Please try again.",
  // Scheduling & offer public token routes (converted alongside, same class).
  SCHEDULE_INVITE_FAILED: "Could not create the scheduling link. Please try again.",
  SCHEDULE_CONFIRM_FAILED: "Could not confirm that slot. Please try again.",
  // Recruiter invite-lifecycle read (W6-3).
  SCHEDULE_LOOKUP_FAILED: "Could not load the scheduling overview. Please try again.",
  // Command-palette cross-entity search (SHELL1) — sits directly on better-sqlite3.
  SEARCH_FAILED: "Search is unavailable right now. Please try again.",
  // Sidebar attention badges (SHELL2) — same store class.
  ATTENTION_FAILED: "Could not load attention counts. Please try again.",
  OFFER_RESPOND_FAILED: "Could not record your response. Please try again.",
} as const;

export type StoreErrorCode = keyof typeof STORE_ERRORS;

/** Safe 500 responder for store-backed handlers. Logs the full error server-side
 *  under `[route] CODE`, then returns `{ error: <generic message>, code }` — the
 *  raw `err.message` (and any SQLite/filesystem detail in it) never crosses the
 *  wire. `route` is a short tag for the server log only, e.g. "api:jds". */
export function safeJsonError(err: unknown, route: string, code: StoreErrorCode, status = 500): NextResponse {
  console.error(`[${route}] ${code}`, err);
  return NextResponse.json({ error: STORE_ERRORS[code], code }, { status });
}
