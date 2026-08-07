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
  JD_GENERATE_FAILED: "Could not start the AI build. Please try again.",
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
  // Candidate-timeline join for the drawer (c6524f2f).
  PIPELINE_TIMELINE_FAILED: "Could not load the candidate timeline. Please try again.",
  // Sourcing "reach out" (idea JOB3): sits on createPipelineEntry + the outreach
  // automation subprocess (Claude CLI), whose thrown errors embed internal detail.
  OUTREACH_FAILED: "Could not reach out to that candidate. Please try again.",
  // Scheduling & offer public token routes (converted alongside, same class).
  SCHEDULE_INVITE_FAILED: "Could not create the scheduling link. Please try again.",
  SCHEDULE_INVITE_BULK_FAILED: "Could not send the scheduling links. Please try again.",
  SCHEDULE_CONFIRM_FAILED: "Could not confirm that slot. Please try again.",
  // Recruiter invite-lifecycle read (W6-3).
  SCHEDULE_LOOKUP_FAILED: "Could not load the scheduling overview. Please try again.",
  // Recruiter-side invite control: cancel / reschedule / no-show / resolve-reconcile.
  SCHEDULE_MANAGE_FAILED: "Could not update that interview. Please try again.",
  // Command-palette cross-entity search (SHELL1) — sits directly on better-sqlite3.
  SEARCH_FAILED: "Search is unavailable right now. Please try again.",
  // Sidebar attention badges (SHELL2) — same store class.
  ATTENTION_FAILED: "Could not load attention counts. Please try again.",
  OFFER_RESPOND_FAILED: "Could not record your response. Please try again.",
  // Candidate application-status lookup (idea-e76a6fb2) — public token route over
  // the application-status store.
  STATUS_LOOKUP_FAILED: "Could not load your application status. Please try again.",
  // Art. 86 candidate decision history (public status-token sibling route).
  STATUS_DECISIONS_FAILED: "Could not load your decision history. Please try again.",
  // W0.6b candidate-NPS capture (public status-token sibling route). Separate read and
  // write codes: a failed submit must not read as "we could not load the question", or
  // the candidate re-answers into the same error.
  STATUS_NPS_READ_FAILED: "Could not load the feedback question. Please try again.",
  STATUS_NPS_WRITE_FAILED: "Could not record your feedback. Please try again.",
  // The two PUBLIC apply submissions (conversational + quick lead form). Their
  // catch paths sit on better-sqlite3, a Python profile-build subprocess, an fs
  // temp write and the comms dispatcher — every one throws messages carrying
  // internal detail (SQLITE_* codes, absolute db/temp paths, Python tracebacks)
  // that these routes were forwarding verbatim to ANONYMOUS visitors. The
  // deliberate human-written 4xx validation strings above them stay as they are:
  // those are client-safe by construction and tell the applicant what to fix.
  APPLY_FAILED: "Could not submit your application. Please try again.",
  // The candidate's OPTIONAL post-accept profile-gap answers (public capability
  // token route; same subprocess/SQLite catch surface as the apply routes above).
  // Framed so it can never read as "your application failed" — it didn't.
  FOLLOWUP_FAILED: "Could not save those answers. Your application is safely filed — please try again.",
  // Standing silver-medalist feed (idea-fdb45cd0) over the rediscovery-alert store.
  REDISCOVERY_ALERTS_FAILED: "Could not load rediscovery alerts. Please try again.",
  // GDPR self-service data/erasure (public token route over the pipeline entry).
  DATA_LOOKUP_FAILED: "Could not load your data right now. Please try again.",
  DATA_ERASE_FAILED: "Could not complete the erasure right now. Please try again.",
  // Recruiter-facing consent snapshot + audit trail (drawer Data & consent panel).
  CONSENT_LOOKUP_FAILED: "Could not load consent details. Please try again.",
  // Onboarding hand-off (#6) — runs / templates / checklist / e-sign seam.
  ONBOARDING_FAILED: "Could not complete the onboarding action. Please try again.",
  // NL pipeline command bar (#7) — parse + preview/execute.
  COMMAND_FAILED: "Could not run that command. Please try again.",
  // Cross-company reference tier (Phase 2) — the org-wide hiring benchmark (org_id-join).
  BENCHMARK_FAILED: "Could not load the org benchmark. Please try again.",
  // Agent-candidate bridge routes — all sit on better-sqlite3 + external fetches
  // whose thrown errors can embed internal detail.
  AGENT_FIT_FAILED: "Could not start the agent-fit analysis. Please try again.",
  AGENT_DISPATCH_FAILED: "Could not dispatch the agent to Personas. Please try again.",
  AGENT_LIST_FAILED: "Could not load the agent roster. Please try again.",
  AGENT_BRIDGE_FAILED: "Could not load the Personas bridge status. Please try again.",
  AGENT_PAIR_FAILED: "Could not pair with Personas. Please try again.",
  AGENT_CATALOG_FAILED: "Could not load the connector catalog. Please try again.",
  AGENT_REFRESH_FAILED: "Could not refresh the agent status. Please try again.",
  AGENT_REPORT_FAILED: "Could not record the agent report. Please try again.",
} as const;

export type StoreErrorCode = keyof typeof STORE_ERRORS;

/** Safe 500 responder for store-backed handlers. Logs the full error server-side
 *  under `[route] CODE`, then returns `{ error: <generic message>, code }` — the
 *  raw `err.message` (and any SQLite/filesystem detail in it) never crosses the
 *  wire. `route` is a short tag for the server log only, e.g. "api:jds". */
// --- Deliberate refusals -----------------------------------------------------
//
// The sibling of STORE_ERRORS, and deliberately NOT part of it. A store error is
// an accident whose real message must be hidden; a refusal is a decision whose
// message IS the information the candidate needs ("this offer has expired").
// STORE_ERRORS' own note above says these client-safe 4xx strings are a separate
// class — this registry is that class, given the one thing it was missing.
//
// They were being returned as bare `{ error }`, so the client had no code to
// resolve and useErrorMessage() fell through to a generic "something went wrong"
// in all four languages — on public, token-authenticated candidate surfaces
// where the specific reason is the entire point. Each code now has an
// `errors.<CODE>` message; npm run i18n:check pins this registry to the catalog
// exactly as it pins STORE_ERRORS, so a typo or a new refusal cannot silently
// degrade to the generic.
//
// The English here stays canonical for the server log and for API consumers;
// the client renders the localized message from the code.
export const REFUSAL_ERRORS = {
  /** A submission arrived for a posting whose intake is closed (410). */
  POSTING_CLOSED: "This role's intake has closed and is no longer accepting submissions.",
  /** The offer link is past its deadline (410). */
  OFFER_EXPIRED: "This offer has expired.",
  /** No offer for this token (404). */
  OFFER_NOT_FOUND: "Offer not found.",
  /** A work-session id presented without, or with the wrong, apply token (403). */
  SESSION_TOKEN_REQUIRED: "This work session belongs to a different apply link.",
} as const;

export type RefusalErrorCode = keyof typeof REFUSAL_ERRORS;

/** Refusal envelope: the canonical English plus its code, at `status`. Unlike
 *  safeJsonError this logs nothing — a refusal is an expected outcome, not a
 *  fault, and logging every closed posting would be noise. */
export function jsonRefusal(code: RefusalErrorCode, status: number): NextResponse {
  return NextResponse.json({ error: REFUSAL_ERRORS[code], code }, { status });
}

export function safeJsonError(err: unknown, route: string, code: StoreErrorCode, status = 500): NextResponse {
  console.error(`[${route}] ${code}`, err);
  return NextResponse.json({ error: STORE_ERRORS[code], code }, { status });
}
