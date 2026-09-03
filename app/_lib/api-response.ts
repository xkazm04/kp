import { NextResponse } from "next/server";
import { RATE_LIMITED_ERROR } from "./rate-limit";

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
  // Role-intake dialog routes (docs/concepts/role-intake-dialog.md): all sit on
  // better-sqlite3 + the spawned intake engine, whose thrown errors embed
  // internal detail (paths, provider stderr).
  INTAKE_CREATE_FAILED: "Could not start the intake session. Please try again.",
  INTAKE_LIST_FAILED: "Could not load intake sessions. Please try again.",
  INTAKE_READ_FAILED: "Could not load the intake session. Please try again.",
  INTAKE_MESSAGE_FAILED: "Could not process that message. Please try again.",
  INTAKE_VOICE_CONNECT_FAILED: "Could not start the voice call. Please try again.",
  INTAKE_VOICE_TURN_FAILED: "Could not process that utterance. Please try again.",
  INTAKE_VOICE_COMPLETE_FAILED: "Could not process the voice transcript. Please try again.",
  INTAKE_ATTACHMENT_FAILED: "Could not update the attachments. Please try again.",
  INTAKE_BRIEF_SAVE_FAILED: "Could not save the brief edit. Please try again.",
  INTAKE_REOPEN_FAILED: "Could not re-open the session. Please try again.",
  INTAKE_DOSSIER_FAILED: "Could not attach the codebase reading to this session. Please try again.",
  INTAKE_COMPOSE_APP_MASTER_FAILED: "Could not compose the App master spec. Please try again.",
  INTAKE_PROMOTE_FAILED: "Could not create the JD from this brief. Please try again.",
  // Recruiter-side analyzed-candidates read (biz-ui scan 2026-06-12 #1).
  JD_ANALYSES_FAILED: "Could not load candidates for this JD. Please try again.",
  TEMPLATE_LIST_FAILED: "Could not load templates. Please try again.",
  TEMPLATE_LOAD_FAILED: "Could not load the template. Please try again.",
  TEMPLATE_CREATE_FAILED: "Could not save the template. Please try again.",
  TEMPLATE_UPDATE_FAILED: "Could not update the template. Please try again.",
  TEMPLATE_DELETE_FAILED: "Could not delete the template. Please try again.",
  // The jobs area (/perfect 2026-09-02, api-jobs). Ten handlers still forwarded the
  // thrown message: better-sqlite3 constraint text, the absolute db path, and — on the
  // three that spawn — Python tracebacks and CLI stderr straight off python-runner.
  JOB_LIST_FAILED: "Could not load the job catalog. Please try again.",
  JOB_LOAD_FAILED: "Could not load this role. Please try again.",
  JOB_INGEST_FAILED: "Could not read that job ad. Please try again.",
  JOB_PUBLISH_FAILED: "Could not take this role live. Please try again.",
  JOB_CLOSE_FAILED: "Could not close this role. Please try again.",
  JOB_CANDIDATES_FAILED: "Could not rank candidates for this role. Please try again.",
  JOB_REDISCOVER_FAILED: "Could not look through past candidates for this role. Please try again.",
  JOB_WINNABILITY_FAILED: "Could not grade this role against the candidate pool. Please try again.",
  JOB_CAMPAIGN_FAILED: "Could not generate the campaign pack. Please try again.",
  JOB_ASSIGNMENTS_FAILED: "Could not load the work samples for this role. Please try again.",
  // The automation clock's control surface (/perfect 2026-09-03, pipeline-board-3).
  // POST here writes the schedule row and can force a full policy pass, so its catch
  // can surface better-sqlite3 constraint text, the db path, and the spawned pass's
  // Python traceback.
  SCHEDULE_UPDATE_FAILED: "Could not update the automation clock. Please try again.",
  // NOT a thrown store error: GET /api/jobs raises this deliberately when the
  // catalog is empty AND the seed health report names a failed jobs seed. The
  // failing PATH and reason are operator detail — they go to the server log
  // through safeJsonError, never into the catalog's red box (jobs-workspace-2).
  JOB_SEED_BROKEN: "The job catalog is empty — its seed data failed to load. Check the server log.",
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
  STAGE_IMPACT_FAILED: "Could not check who is on each pipeline step. Please try again.",
  // NOT "nothing was saved": the route moves candidates FIRST and writes the axis
  // SECOND, deliberately (a failed axis write leaves people on a column that still
  // exists; the reverse strands them on one the board no longer draws). So a
  // failure here genuinely can land with the moves already applied and the shape
  // unchanged, and the old message told the operator the opposite of the truth.
  STAGE_MIGRATION_FAILED: "Could not finish the pipeline change. Candidates may already have been moved; re-open the step editor to see where things stand.",
  PIPELINE_CREATE_FAILED: "Could not add to the pipeline. Please try again.",
  PIPELINE_ACTION_FAILED: "Could not apply that action. Please try again.",
  PIPELINE_EVENTS_FAILED: "Could not load recent activity. Please try again.",
  // Candidate-timeline join for the drawer (c6524f2f).
  PIPELINE_TIMELINE_FAILED: "Could not load the candidate timeline. Please try again.",
  // Sourcing "reach out" (idea JOB3): sits on createPipelineEntry + the outreach
  // automation subprocess (Claude CLI), whose thrown errors embed internal detail.
  OUTREACH_FAILED: "Could not reach out to that candidate. Please try again.",
  // Dev-case publish + candidate-feedback drafting. Both sit on better-sqlite3 AND a
  // spawn: publish goes through a distribution adapter, feedback through
  // buildFeedbackBrief's model call — so a thrown message here carries SQLITE_* codes,
  // the absolute db path or provider stderr, and both routes were forwarding it whole.
  DEVCASE_PUBLISH_FAILED: "Could not publish this case. Please try again.",
  DEVCASE_FEEDBACK_FAILED: "Could not draft the candidate feedback. Please try again.",
  // The rest of the dev-case studio's store/spawn catches (/perfect 2026-09-02,
  // api-devcase-1). Thirteen handlers here were still forwarding the thrown message
  // whole - better-sqlite3 SQLITE_* codes, the absolute db path, Python tracebacks from
  // the devcase CLI, a distribution/relay provider's upstream body. They are OFF the
  // error-response-contract ceiling now rather than lowered on it.
  DEVCASE_OUTBOX_FAILED: "Could not load the dev-case outbox. Please try again.",
  DEVCASE_CONTROL_FAILED: "Could not load the assignment control room. Please try again.",
  // The PUBLIC candidate intake - an applicant must never read a store detail.
  DEVCASE_INTAKE_FAILED: "Your submission could not be recorded. Please try again.",
  DEVCASE_LIFECYCLE_LIST_FAILED: "Could not load the assignment runs. Please try again.",
  DEVCASE_LIFECYCLE_START_FAILED: "Could not start that assignment run. Please try again.",
  DEVCASE_APPROVE_FAILED: "Could not approve this assignment. Please try again.",
  DEVCASE_CLOSE_FAILED: "Could not close this assignment. Please try again.",
  DEVCASE_REDESIGN_FAILED: "Could not regenerate this assignment. Please try again.",
  DEVCASE_OUTCOMES_FAILED: "Could not load the hire outcomes. Please try again.",
  DEVCASE_OUTCOME_SAVE_FAILED: "Could not record that outcome. Please try again.",
  DEVCASE_POSTINGS_FAILED: "Could not load the assignment postings. Please try again.",
  DEVCASE_PROMOTE_FAILED: "Could not promote this submission. Please try again.",
  // The last two dev-case leaks on the error-response contract's ceiling: the
  // authenticated submission door (better-sqlite3 + the distribution adapter's
  // acknowledgement send) and proactive sourcing (better-sqlite3 + the matching
  // spawn). Both were forwarding the thrown message whole.
  DEVCASE_SUBMIT_FAILED: "Could not record that submission. Please try again.",
  DEVCASE_SOURCE_FAILED: "Could not source candidates for this assignment. Please try again.",
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
  // App master repo scan (P2) — the start route spawns git + Python, the read route
  // sits on better-sqlite3; both can throw with a local filesystem path inside the
  // message, which is exactly what must not reach the wire.
  REPO_SCAN_FAILED: "Could not start the repository scan. Please try again.",
  REPO_SCAN_READ_FAILED: "Could not load the repository scan. Please try again.",
  // Operator companion (docs/features/companion/README.md). The message route
  // spawns companion_cli, whose thrown errors carry provider stderr and the
  // operator's own brain-tree paths — neither belongs on the wire.
  COMPANION_THREADS_FAILED: "Could not load your conversations with Candi. Please try again.",
  COMPANION_THREAD_CREATE_FAILED: "Could not start a new conversation with Candi. Please try again.",
  COMPANION_MESSAGE_FAILED: "Could not process that message. Please try again.",
  // Proposal resolution (WP3). NOT_FOUND and RESOLVED are deliberate, distinct
  // codes rather than one generic failure: "that proposal is gone" and "someone
  // already answered it" are different facts, and the second is the ordinary
  // outcome of two open docks rather than an error.
  COMPANION_PROPOSAL_NOT_FOUND: "That proposal is no longer available.",
  COMPANION_PROPOSAL_RESOLVED: "That proposal was already answered.",
  COMPANION_PROPOSAL_FAILED: "Could not run that proposal. Nothing was changed.",
  // Memory consent (WP4). The brain doors spawn companion_cli and their thrown
  // errors carry the operator's own home-directory paths, which is precisely the
  // detail this registry exists to keep off the wire.
  COMPANION_BRAIN_FAILED: "Could not check this machine for Candi's memory. Please try again.",
  // The edge pairing (app/api/edge). The catch sits over better-sqlite3 AND the
  // at-rest encryption of the shared secret, whose thrown messages carry key and
  // file detail — exactly what must not reach a browser.
  EDGE_SAVE_FAILED: "Could not save the edge pairing. Please try again.",
  // The two voice host routes (/api/tts, /api/stt). Their 500 sits over a cloud
  // adapter's HTTP body, a spawned local sidecar's stderr and the operator's own
  // model paths — every one of them internal detail the route was forwarding
  // verbatim as "synthesis failed" / "transcription failed" with no code at all.
  TTS_FAILED: "Could not speak that just now. Please try again.",
  STT_FAILED: "Could not transcribe that recording. Please try again.",
  // The Fit Matrix's two routes (/perfect 2026-09-03, matrix-ui-2). Both spawn Python
  // and both answered a bare `{ error: err.message }` — matrix_cli's stderr carries the
  // temp workdir path and a traceback, reasoning_cli's carries provider stderr. Kept as
  // two codes, not one: "the grid could not be built" and "that one match could not be
  // explained" are different failures with different next moves.
  MATRIX_BUILD_FAILED: "Could not build the fit matrix. Please try again.",
  MATCH_REASONING_FAILED: "Could not explain that match. Please try again.",
  // The decision-rules write (/api/decisions/config). Its 500 sits over the
  // decision-config store's own SQLite connection, whose thrown messages carry
  // constraint text and the absolute db path; it was forwarding `error.message`
  // verbatim with no code, so the Hiring composer could only paint English.
  DECISION_CONFIG_SAVE_FAILED: "Could not save these rules. Please try again.",
  // The analytics WRITE doors (/perfect 2026-09-03, analytics-writes-check-authority).
  // Both sit directly over better-sqlite3 (setChannelSpend / setAnalyticsTarget) and
  // were forwarding `error.message` verbatim — a UNIQUE/CHECK constraint string or the
  // absolute db path, painted into the Economics board in English for every locale.
  ANALYTICS_SPEND_SAVE_FAILED: "Could not save that spend figure. Please try again.",
  ANALYTICS_TARGET_SAVE_FAILED: "Could not save that target. Please try again.",
  /** The decision log page read (/api/analytics/decisions). Two full-table reads plus
   *  the sealed-record joins, all over the store's own connection. */
  DECISION_LOG_LOAD_FAILED: "Could not load the decision log. Please try again.",
  /** The calibration apply's 500 — the transactional decision-config write plus the
   *  seal. Distinct from CALIBRATION_* refusals below: this one is a fault, and the
   *  floor may or may not have moved, so the panel must say "reload", not "stale". */
  CALIBRATION_APPLY_FAILED: "Could not apply that threshold. Reload the panel and check the current floor.",
  /** The metric pack could not be assembled — it reads four stores over the shared
   *  connection, and it is the one analytics read that is also a DOWNLOAD. */
  ANALYTICS_METRIC_PACK_FAILED: "Could not build the metric pack. Please try again.",
  // The candidate-focus ranking (/api/match, /perfect 2026-09-03). The third route in
  // the matrix family and the last one still answering `{ error: err.message }` — where
  // that message was `parseStderrError`'s RAW STDERR: match_cli's Python traceback and
  // the absolute temp workdir path, forwarded to the browser. Distinct from
  // MATRIX_BUILD_FAILED because the reader is looking at ONE candidate's ranking, not
  // at the grid.
  MATCH_RUN_FAILED: "Could not rank that candidate against the roles. Please try again.",
  // The billing doors (/perfect 2026-09-03, billing-ui). All three answered prose with
  // no code: the overview's catch hand-rolled its own `{ error }`, and checkout/portal
  // forwarded the GATEWAY's thrown message — a merchant-of-record HTTP body, i.e. an
  // upstream provider's internals, in an English nobody in the catalog chose.
  BILLING_OVERVIEW_FAILED: "Could not load billing. Please try again.",
  BILLING_CHECKOUT_FAILED: "Could not start the checkout. Please try again.",
  BILLING_PORTAL_FAILED: "Could not open the customer portal. Please try again.",
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
  /** A non-numeric automation interval (400). The dock's own field clamps to
   *  [1, 1440], so reaching this means a hand-rolled call or a broken client —
   *  and the operator still deserves the reason in their own language. */
  SCHEDULE_INTERVAL_INVALID: "The automation interval must be a number of minutes.",
  /** A submission arrived for a posting whose intake is closed (410). */
  POSTING_CLOSED: "This role's intake has closed and is no longer accepting submissions.",
  /** The offer link is past its deadline (410). */
  OFFER_EXPIRED: "This offer has expired.",
  /** No offer for this token (404). */
  OFFER_NOT_FOUND: "Offer not found.",
  /** A work-session id presented without, or with the wrong, apply token (403). */
  SESSION_TOKEN_REQUIRED: "This work session belongs to a different apply link.",
  /** The apply link does not resolve to a posting that is taking work (404). The two
   *  causes stay DELIBERATELY lumped: telling a caller "no such token" apart from
   *  "that one closed" turns the mint endpoint into an oracle for guessing tokens, and
   *  the candidate's next action is identical either way. */
  DEVCASE_SESSION_UNAVAILABLE: "This case is not accepting submissions.",
  /** The per-token/day session quota is spent (429). Distinct from TOO_MANY_REQUESTS:
   *  that is the shared per-IP throttle refusing a burst, this is one apply link having
   *  minted its day's worth of sessions, and the candidate's remedy ("come back later",
   *  not "slow down") differs. */
  DEVCASE_SESSION_QUOTA: "Too many sessions started for this case. Try again later.",
  /** An on-the-job rating was posted for an entry that is not on the board (404). */
  HIRE_RATING_ENTRY_NOT_FOUND: "That candidate is not on this board.",
  /** …or for someone who never took the job (409). The stage is re-read server-side,
   *  so a drawer left open across a stage change refuses instead of rating a
   *  candidate who was never hired. */
  HIRE_RATING_NOT_HIRED: "Only a hired candidate can carry an on-the-job rating.",
  /** …or with a value outside the 1..5 scale (400). */
  HIRE_RATING_INVALID: "An on-the-job rating must be a whole number from 1 to 5.",
  /** "Connect the memory that is already here" arrived when there is no memory
   *  here (409). The probe is re-run inside the POST, so a wizard left open
   *  while the folder was deleted refuses instead of recording consent to a
   *  brain that does not exist. */
  COMPANION_BRAIN_ABSENT: "There is no companion memory on this machine to connect.",
  /** An App-master write (dossier merge / compose) was computed from a version of
   *  the intake row that a dialog turn has since replaced (409). Not a fault: the
   *  spawn behind both writes takes minutes, and refusing is what stops a stated
   *  value from being regressed. The client re-runs it against the current row. */
  INTAKE_BRIEF_MOVED: "The brief changed while that was being computed, so it was re-read rather than overwritten.",
  /** A companion thread vanished between the route's read and its write (404).
   *  Both appends re-check the thread inside their own transaction and answer
   *  null, so a conversation deleted mid-request refuses here instead of
   *  returning a 200 whose transcript is missing the reply it claims to hold. */
  COMPANION_THREAD_NOT_FOUND: "That conversation no longer exists.",
  /** The shared per-IP throttle refused this call (429). The message IS
   *  `RATE_LIMITED_ERROR` — one string, one meaning, wherever the limiter
   *  refuses — and the code is only what lets the client localize it. Distinct
   *  from `errors.RATE_LIMITED`, which is GitHub's upstream policy refusal and
   *  tells the operator to configure a token; conflating the two would answer a
   *  throttled companion turn with advice about GITHUB_TOKEN. */
  TOO_MANY_REQUESTS: RATE_LIMITED_ERROR,
  // ---- Voice-interview refusals (/perfect 2026-09-02, api-voice-interview).
  // Every refusal on the two doors that SPEND — POST /api/interview/create (a
  // model-backed grounding plus an email to the candidate) and POST
  // /api/interview/connect (the provider credential mint) — used to be a bare
  // English sentence with no code. /connect is a PUBLIC candidate surface reached
  // from an emailed link in the candidate's own language, so its five lifecycle
  // refusals were the worst placed of the lot: the portal painted the server's
  // English at a Czech applicant who had just been told, in Czech, to click it.
  /** The screen was asked for without naming a candidate — neither `entryId` nor
   *  `submissionId` arrived in a usable shape (400). */
  INTERVIEW_ENTRY_REQUIRED: "Say which candidate this interview is for.",
  /** A dev-case submission id that resolves to nothing, or to another team's
   *  submission (404). The two stay DELIBERATELY lumped: a distinct refusal would
   *  confirm which submission ids exist on other tenants, and this door can write a
   *  stranger's name and contact onto the caller's board. */
  INTERVIEW_SUBMISSION_NOT_FOUND: "That submission could not be found.",
  /** A submission with no evaluation behind it (400). There is nothing to promote
   *  on, and the brief the screen would carry is built from the evaluation's own
   *  minted follow-ups. */
  INTERVIEW_SUBMISSION_NOT_EVALUATED: "Evaluate the submission before starting a voice screen.",
  /** A reissue arrived while the candidate is mid-conversation (409). Revoking
   *  would kill the live call and email them a second invite while they talk;
   *  `force: true` is the explicit recruiter override. */
  INTERVIEW_CALL_IN_PROGRESS: "This candidate is on the call right now. Wait for it to finish before issuing a new link.",
  /** The presented interview token resolves to nothing (404) — a mistyped or
   *  superseded link, never an invitation to open a lab session. */
  INTERVIEW_LINK_NOT_FOUND: "This interview link isn't valid.",
  /** The link was pulled by the recruiter, or its candidate is closed out (409). */
  INTERVIEW_LINK_INACTIVE: "This interview link is no longer active.",
  /** An untaken link past INTERVIEW_LINK_TTL_DAYS (409). An auto-emailed
   *  credential must not stay valid forever. */
  INTERVIEW_LINK_EXPIRED: "This interview link has expired. Ask the recruiter for a fresh one.",
  /** The screen is finished (409). `completed` is single-use, enforced by the
   *  status CAS in markInterviewStarted, so a retake mints no credentials. */
  INTERVIEW_ALREADY_COMPLETED: "This interview has already been completed.",
  /** A candidate-mode connect with no explicit consent (403). Consent is the legal
   *  basis for an AI-conducted, transcribed interview, so it is enforced server-side
   *  and not merely by the browser's disabled Start button. */
  INTERVIEW_CONSENT_REQUIRED: "Recording consent is required before the interview can start.",
  /** The requested provider is neither 'openai' nor 'elevenlabs' (400). */
  INTERVIEW_PROVIDER_INVALID: "That voice provider isn't one this server knows.",
  /** The chosen provider has no keys on this install (503). Which env vars are
   *  missing rides alongside in `need` for the operator; the candidate reads only
   *  this sentence. */
  INTERVIEW_PROVIDER_UNCONFIGURED: "The voice provider isn't configured on this server, so the call can't start.",
  /** A tokenless connect while the dev lab harness is off (403). */
  INTERVIEW_LAB_DISABLED: "The interview lab is not enabled on this server.",
  // ---- Document-upload refusals (app/_lib/upload-constraints.ts). The document
  // twins of AUDIO_UNSUPPORTED_TYPE / AUDIO_TOO_LARGE: the gate that guards every
  // CV / JD / company file answered hardcoded English on BOTH sides of the wire
  // until this change, so a Czech recruiter dropping a 20 MB PNG read an English
  // sentence the surface had painted from the server. The MB figure is written
  // out here (as the audio pair does) rather than interpolated — the resolver
  // useErrorMessage() passes no values — and upload-constraints.test.ts fails if
  // MAX_FILE_MB and this copy ever say different numbers.
  /** The file is not one of PDF / DOCX / TXT / MD (400, or the client gate). */
  UPLOAD_UNSUPPORTED_TYPE: "Use a PDF, DOCX, TXT or MD file.",
  /** The file is over MAX_FILE_BYTES (413, or the client gate). */
  UPLOAD_TOO_LARGE: "That file is over the 8 MB upload limit.",
  // ---- /api/analyze's own two form refusals. Both were bare English 400s that
  // the client collapsed into one generic "analysis failed" line.
  /** The submitted form carried no CV/profile file at all (400). */
  ANALYZE_CV_REQUIRED: "Attach a CV or profile file to analyze.",
  /** More CV variants than one run compares (400) — MAX_CV_VARIANTS, pinned to
   *  this copy by upload-constraints.test.ts the same way the MB figure is. */
  ANALYZE_TOO_MANY_VARIANTS: "Compare at most 3 CV variants in one run.",
  // ---- App-master intake refusals (docs/features/intake/README.md §"Shape
  // app_master"). Both routes used to answer these as bare English strings with
  // no code, so the card collapsed a throttle, "the scan has not landed" and
  // "answer the dialog first" into one "compose failed" line — three different
  // next actions, rendered identically, in English, to every locale.
  /** The intake id does not resolve in this workspace (404). */
  INTAKE_NOT_FOUND: "That intake session could not be found.",
  /** The session was promoted: the JD exists and its grounding record is frozen (409). */
  INTAKE_FROZEN: "This intake was promoted, so its grounding and its spec are frozen.",
  /** A dossier was posted to a session that was never started from a repo scan (400). */
  INTAKE_NOT_FROM_SCAN: "This intake was not started from a repository scan.",
  /** The posted scanId is not the one THIS intake was created from (400) — the gate
   *  that stops another session's scan output from landing on this brief. */
  INTAKE_SCAN_MISMATCH: "That scan belongs to a different intake session.",
  /** The posted body did not clamp to `repoDossierSchema` (400). */
  INTAKE_DOSSIER_INVALID: "That codebase reading is not in the expected shape.",
  /** Compose was asked of a session that is not an App-master one (400). */
  INTAKE_NOT_APP_MASTER: "This is not an App master intake, so there is no spec to compose.",
  /** Compose was asked before the repo scan finished (409). Ordinary timing, not
   *  a fault: the scan lands on its own and the control becomes usable. */
  INTAKE_SCAN_NOT_LANDED: "The repository scan has not landed yet. The spec composes once it does.",
  /** Compose was asked with an empty brief (400) — nothing has been said yet for
   *  the pure composer to turn into a mandate. */
  INTAKE_BRIEF_EMPTY: "The brief is still empty. Answer the dialog first, then compose.",
  // ---- The role-intake DIALOG's own refusals (docs/features/intake/README.md).
  // Nine routes answered nine kinds of English prose with NO code, and the client
  // funnelled every one of them into a single "send failed" line — so "you have
  // five attachments already", "that JD is not in your library" and "the session
  // is closed" were one indistinguishable red sentence, in English, to every
  // locale. The two App-master siblings above already did it right; this is the
  // rest of the surface catching up.
  /** A message/utterance arrived for a session that is not open (409). Distinct
   *  from INTAKE_FROZEN on purpose: a `complete` session can be RE-OPENED and that
   *  is the reader's next action, where a promoted one is final. */
  INTAKE_CLOSED: "This intake session is closed. Re-open it to keep talking.",
  /** An empty message, spoken utterance or attachment note (400). */
  INTAKE_TEXT_REQUIRED: "There is nothing to send. Write or say something first.",
  /** A brief edit whose payload did not resolve to a brief at all (400). Not
   *  INTAKE_BRIEF_EMPTY: that one is about the SESSION's brief having nothing in
   *  it yet, this one is about the request body. */
  INTAKE_BRIEF_INVALID: "That brief edit was not in the expected shape.",
  /** Promote was asked of a brief that has not captured enough to become a JD
   *  (400). The message names what is missing — that IS the next action. */
  INTAKE_BRIEF_NOT_READY: "The brief needs a role title plus one dealbreaker or 90-day outcome before it can become a JD.",
  /** Re-open was asked of a session that is already open (409). */
  INTAKE_ALREADY_OPEN: "This session is already open.",
  /** The per-session reference-material ceiling is spent (400). The cap rides
   *  alongside in `max` — a number, not a sentence, so it localizes. */
  INTAKE_ATTACHMENT_LIMIT: "This session already holds as much reference material as it can.",
  /** A note longer than the per-attachment text cap (400). Same shape as
   *  INTAKE_ATTACHMENT_LIMIT — the cap rides alongside in `max`. The route used
   *  to silently `.slice()` the overflow away instead: the requestor pasted a
   *  long thread, saw it accepted, and the agent grounded on a document whose
   *  tail had been thrown away with nothing said. A refusal the composer can
   *  restore from is the honest half of that trade. */
  INTAKE_ATTACHMENT_TOO_LONG: "That note is longer than one piece of reference material can be.",
  /** A remove naming a position the list does not have (400) — a stale pane. */
  INTAKE_ATTACHMENT_INDEX: "That piece of reference material is no longer on this session.",
  /** The attached JD slug does not resolve in this workspace (404). Separate from
   *  INTAKE_NOT_FOUND: the session is fine, the JD is the thing that is missing. */
  INTAKE_JD_NOT_FOUND: "That JD is not in this workspace's library.",
  /** An extraction sweep on a session with no transcript and no posted turns
   *  (400) — the ordinary "the call produced nothing yet", not a fault. */
  INTAKE_NOTHING_TO_EXTRACT: "There is nothing to extract yet.",
  /** The voice transport is not configured on this install (503). The env vars an
   *  operator must set ride alongside in `need`: DATA the reader's own sentence
   *  needs, rather than English prose with the variables baked in. */
  INTAKE_VOICE_NOT_CONFIGURED: "Voice is not configured on this install.",
  /** The edge pairing was refused before anything was written (400): the endpoint is
   *  not an allowed public https URL, or a field was the wrong type. A DECISION, so
   *  the reader is told what to change rather than "something went wrong". */
  EDGE_CONFIG_REJECTED: "That edge endpoint was refused. It must be a public https:// URL.",
  /** Publishing the sealing key did not happen (400) — usually because no edge is
   *  paired yet, or it did not answer. Nothing was rotated; retrying is safe. */
  EDGE_PAIR_REFUSED: "Could not publish the sealing key to the edge. Check the pairing and try again.",
  // ---- The voice host routes' boundary refusals (/api/tts, /api/stt). Every
  // one of these was an English sentence with no code, on routes a Czech,
  // German or French operator reaches through the same dock as everything else.
  /** The POST body was not JSON at all (400) — /api/tts. */
  VOICE_REQUEST_INVALID: "That request was not valid JSON.",
  /** No `audio` part, an empty one, or a body that is not multipart (400). */
  AUDIO_MISSING: "Attach a recording to transcribe.",
  /** A container no engine here accepts (400). The remedy is a re-export, so it
   *  stays distinct from AUDIO_TOO_LARGE: "convert it" and "shorten it" are
   *  different next actions and a single generic 400 told the operator neither. */
  AUDIO_UNSUPPORTED_TYPE: "Use WAV, MP3, M4A, WebM, OGG or FLAC for the recording.",
  /** Past the 25 MB audio ceiling (413, the shared FILE_TOO_LARGE_STATUS). */
  AUDIO_TOO_LARGE: "That recording is over the 25 MB upload limit.",
  /** The clip is well-formed and within the byte cap but longer than the serving
   *  engine's declared ceiling (413). The engine's own `too_long`, given the same
   *  status as the byte cap because the remedy — split it — is the same one. */
  STT_TOO_LONG: "That recording is longer than this engine can transcribe in one go. Split it and try again.",
  // ---- The pipeline BOARD's refusals (docs/features/pipeline/README.md). Every
  // one of these was a bare English sentence with no code, on the surfaces a
  // recruiter touches most: the per-card route, the shared move/decide helper, the
  // batch route's per-id reasons and the step editor. The bulk action bar rendered
  // that prose VERBATIM, so a Czech, German or French board answered a lost race in
  // English — while the outcomes route two directories over already did it right.
  /** The entry is not on this board (404): deleted, or another tenant's. */
  PIPELINE_ENTRY_NOT_FOUND: "That candidate is no longer on this board.",
  /** A move to a step this workspace's axis does not contain (400). The available
   *  ids ride alongside in `stages` — a list, not a sentence, so it localizes. */
  PIPELINE_STAGE_UNKNOWN: "That is not a step on this board.",
  /** A manual set_stage straight onto the terminal column (422). */
  PIPELINE_TERMINAL_NOT_MANUAL: "The final step is reached when the candidate accepts an offer, not by a manual move. Move them to the offer step and extend an offer.",
  /** …and the same rule for an accept that would LAND there (422). Separate code:
   *  the remedy differs — draft an offer, rather than move them to the offer step. */
  PIPELINE_TERMINAL_NOT_ADVANCE: "The final step is reached when the candidate accepts an offer, not by advancing them. Draft and extend an offer instead.",
  /** A set_stage whose CAS lost, or whose entry is closed out (409). */
  PIPELINE_MOVE_CONFLICT: "Couldn't move this candidate: they were just changed, or they are closed out. Refresh and try again.",
  /** An accept/reject decided against a stage that has since moved (409). */
  PIPELINE_STAGE_CHANGED: "This candidate's step changed since the view was opened. Refresh and decide again.",
  /** A body naming an action this board does not have (400). */
  PIPELINE_ACTION_UNKNOWN: "That is not an action this board supports.",
  /** A GitHub evidence payload that did not clamp to the shared coercer (400). */
  PIPELINE_GITHUB_EVIDENCE_INVALID: "That GitHub evidence is not in the expected shape.",
  /** `notes` arrived as something other than text (400). */
  PIPELINE_NOTES_INVALID: "A candidate note must be text.",
  /** …or past the column's ceiling (400). The cap rides alongside in `max`. */
  PIPELINE_NOTES_TOO_LONG: "That note is too long to save.",
  /** Reinstate was asked of an entry that is not rejected (409) — already
   *  reinstated, or closed a different way (the candidate declined, or was
   *  rematched), which a reinstate must never quietly reverse. */
  PIPELINE_NOT_REINSTATABLE: "There is no auto-rejection to reverse here — this candidate was already reinstated, or was closed a different way.",
  /** resolve_intake on an entry carrying no degraded-intake flag (404). */
  PIPELINE_INTAKE_NOT_DEGRADED: "There is no degraded-intake flag to resolve on this candidate.",
  /** The offer was drafted and its link minted, but the message did not go out
   *  (502). Deliberately NOT a fault code: the approval is left open on purpose and
   *  approving again re-sends the SAME link, which is what the reader must know. */
  OFFER_NOT_DISPATCHED: "The offer was drafted but couldn't be sent. Nothing was lost — approve again to re-send the same link.",
  /** The offer DID go out, but the approval could not be cleared because the card
   *  moved while it was sending (409). The candidate holds a live link. */
  OFFER_SENT_APPROVAL_CHANGED: "The offer was sent, but this candidate's approval changed while it went out. Refresh before deciding again.",
  /** A per-item row in a batch that carried no id or an unknown action (400). */
  PIPELINE_BATCH_ITEM_MALFORMED: "That item was missing a candidate or named an action this board does not have.",
  /** The batch POST body was not a non-empty array of items, or was over the
   *  per-call cap (400). The cap rides alongside in `max`. */
  PIPELINE_BATCH_PAYLOAD_INVALID: "That bulk request wasn't in the expected shape, or asked for too many candidates at once.",
  /** A per-item row whose action threw. One entry's fault never aborts the batch,
   *  and the reason it carries back must still be a code, not a raw message. */
  PIPELINE_BATCH_ITEM_FAILED: "Something went wrong applying this one. The rest of the batch was unaffected.",
  /** The proposed board shape did not validate (400). The validator's own detail
   *  rides alongside in `detail` for the operator editing the axis. */
  PIPELINE_AXIS_INVALID: "That pipeline shape isn't valid.",
  /** A migrate mapping whose source is a step the new axis KEEPS, or whose
   *  destination is one it does not contain (400). */
  PIPELINE_MIGRATION_MAPPING_INVALID: "That step mapping doesn't work: candidates can only be moved OFF a step the new pipeline removes, and only ONTO one it keeps.",
  /** Steps being removed still hold candidates and no destination was given (409).
   *  The occupied steps and their counts ride alongside in `unmapped`. */
  PIPELINE_MIGRATION_REQUIRED: "Some steps you removed still hold candidates. Say where each of them should go.",
  // ---- The RECRUITER book path's refusals (docs/features/scheduling/README.md).
  // Every one of these was a bare English sentence with no code, so the Schedule
  // tab funnelled all four into "Failed to load." — the load error's copy, on an
  // action that loaded nothing. A recruiter who lost the hour to a candidate
  // self-booking and one whose candidate was rejected in another tab read the same
  // sentence, in English, in every locale.
  /** The picked hour is spoken for — the candidate's own self-booking, or another
   *  entry's accepted off-hour proposal inside it (409). The remedy is the whole
   *  message: pick a different cell. */
  SCHEDULE_SLOT_TAKEN: "That time is already booked — pick another.",
  /** The linked entry is closed out (409). The grid's entry list is a client-side
   *  snapshot, so a candidate rejected in another tab is still on this one. */
  SCHEDULE_CANDIDATE_INACTIVE: "That candidate is no longer active — nothing was booked.",
  /** The collision-checked transaction refused for any other reason: the invite
   *  moved, or is no longer in a state that takes this slot (409). Nothing was
   *  written, so re-picking after a refresh is safe. */
  SCHEDULE_BOOK_FAILED: "Couldn't book that time. Refresh and pick again.",
  /** The submitted grid cell did not resolve to a real instant (400) — a stale
   *  week pager, or a slot grammar this server no longer parses. */
  SCHEDULE_SLOT_UNRESOLVED: "That grid slot couldn't be resolved to a time.",
  /** The interviewer's connected calendar says that hour is busy (409). The
   *  recruiter's twin of the candidate confirm-time re-check: only a DEFINITE busy
   *  refuses, an unknown (no calendar, failed lookup) proceeds. */
  SCHEDULE_CALENDAR_BUSY: "Your connected calendar is busy then. Pick another time.",
  // ---- The ORGANIZATION's doors (docs/features/organization/README.md).
  // Five refusals that were bare English `{ error }` with no code, so the console
  // resolved every one of them to its own generic "couldn't do that" line — the
  // Workspaces tab even carried a Known-gap comment saying so. Each of these is a
  // DECISION whose reason is the whole remedy: which file to pick, that a replace
  // has to be confirmed, that the person is already here.
  /** The uploaded backup names a different organization (409). A dump is restored
   *  into the org it came from — the ids in the file are that org's — so the remedy
   *  is picking the right file, never retrying this one. */
  RESTORE_FOREIGN_ORG: "This backup belongs to a different organization. A backup is restored into the organization it came from.",
  /** `apply: true` on an org that still holds rows, without `replace: true` (409).
   *  The row count rides alongside in `existingRows`, and the populated tables in
   *  `populated`, so the confirm dialog can say what is about to go. */
  RESTORE_REPLACE_REQUIRED: "Restoring replaces the organization's current data. Confirm replace to proceed.",
  /** An invite addressed at somebody who already holds an active seat in this org
   *  (409). They do not need a link; they need to sign in. */
  INVITE_ALREADY_MEMBER: "That person is already an active member.",
  /** An invite minted AT a role the actor could not assign directly (403). Inviting
   *  at a role grants that role's capabilities, so the delegation ceiling is the
   *  same one `canAssignRole` applies to a role change. */
  INVITE_ROLE_ABOVE_PRIVILEGE: "You can't invite someone at a role above your own privileges.",
  /** The invite form's address did not parse (400). */
  INVITE_EMAIL_INVALID: "A valid email address is required.",
  /** The membership moved while its permissions were being edited (409) — a second
   *  administrator saved the same seat first. Nothing was written, so the remedy is
   *  to reload the roster and decide against what it now says. */
  MEMBER_PERMISSIONS_CHANGED: "This member's permissions changed while you were editing them. Reload and try again.",
  /** An org-level setting (name, app language) changed by a caller without
   *  `org:manage` (403). The organization's language drives background automation
   *  and candidate comms for everyone, so it is an owner/admin setting. */
  ORG_SETTINGS_FORBIDDEN: "Only an organization administrator can change the organization's settings.",
  /** The app language submitted for the organization is not one of the four the
   *  app ships (400). A bad argument, never a permission problem — kept apart from
   *  ORG_SETTINGS_FORBIDDEN so the console cannot blame a recruiter's role for it. */
  ORG_LANGUAGE_INVALID: "That isn't one of the app's languages.",
  /** The matrix scorer refused the request itself (4xx) — a corpus/profile the grid
   *  asked for that the engine will not score. Not a fault, so it is not withheld: the
   *  recruiter's move is to reload or narrow the scope, not to report a crash. */
  MATRIX_INPUT_INVALID: "The fit matrix could not be built from that request.",
  /** The (candidate, role) pair behind a clicked cell no longer resolves (400/404) —
   *  a profile deleted, or a role that left the corpus, between the grid being scored
   *  and the cell being opened. Distinct from MATCH_REASONING_FAILED, which is the
   *  engine falling over: this one is answered by refreshing the grid. */
  MATCH_REASONING_UNAVAILABLE: "That match can no longer be explained — the candidate or role behind it is gone.",
  /** A decision-rules write with no phase or no config in the body (400). */
  DECISION_CONFIG_FIELDS_REQUIRED: "That rules update named no phase, or carried no rules to save.",
  /** The rules failed the phase's schema (400). The validator's own detail — which
   *  field, which bound — rides beside the code as DATA (`detail`): the composer
   *  needs it, but it is English prose and must never be the thing the UI paints. */
  DECISION_CONFIG_INVALID: "Those rules aren't valid for this phase.",
  /** The rules changed since the client read them (409). Nothing was written: the draft
   *  was built on a plan that is gone, so it is dropped rather than merged. */
  DECISION_CONFIG_STALE: "Someone saved a newer version of these rules. Reload and make your change again.",
  /** The board's column axis changed since the composer read it (409) — refused BEFORE
   *  anybody is moved, since the stage ids the mapping names may no longer exist. */
  PIPELINE_AXIS_STALE: "Someone saved a newer version of this pipeline. Reload and make your change again.",
  /** A resend for this outbox row is already in flight in this process (409). The
   *  recovery door spends real email, so a double-click collapses here rather than
   *  dispatching twice — and it now says so with a code, because the button used to
   *  fall through to the generic "couldn't re-send" sentence in all four languages. */
  COMM_RESEND_IN_PROGRESS: "A resend for this message is already in progress.",
  /** A newer real delivery already exists for this message (409), so re-dispatching
   *  it would send the candidate the same offer/rejection twice. Durable, not
   *  in-process: the check reads the outbox. */
  COMM_ALREADY_RESENT: "Already re-sent. A newer delivery exists for this message.",
  /** An approve arrived for a lifecycle that is not at the review gate (409) — a second
   *  tab, a retried fetch, or a reviewer who left the panel open. The stage rides beside
   *  the code as DATA so the panel can say where the case actually is. */
  DEVCASE_LIFECYCLE_NOT_AT_GATE: "This assignment is no longer awaiting review. Reload to see where it is now.",
  /** A write to this team's analytics settings or screening floor by a caller without
   *  `pipeline:write` (403). Spend, targets and the auto-reject floor are recruiter
   *  operations: they move the cost-per-hire denominator, the goal lines every board
   *  is judged against, and the score below which the screening wave rejects
   *  automatically. A `viewer` seat holds `read` and nothing else, and until this code
   *  existed all three routes had no role check at all — the operator gate they leaned
   *  on is "a valid, non-demo session", which every seat has. */
  ANALYTICS_POLICY_FORBIDDEN: "Your role can't change this team's analytics settings or screening floor.",
  /** An apply arrived with no `suggestedThreshold` (400). The value is the operator's
   *  CONSENT — the number they read on the card — so the comparison that keeps a stale
   *  card from moving the live floor cannot be optional: omitting the field used to skip
   *  the guard entirely and apply whatever the live recommendation had become. */
  CALIBRATION_SUGGESTION_REQUIRED: "That apply named no suggested threshold. Reload the panel and apply the number it shows.",
  /** The posted value is no longer the live recommendation (409). Nothing was written;
   *  the recommendation rides beside the code as DATA so the panel can show what the
   *  number became. */
  CALIBRATION_RECOMMENDATION_CHANGED: "The recommendation changed since it was shown. Reload and review the current suggestion.",
  /** There is no recommendation to apply at all (409) — the pairs moved under the card,
   *  or the clean arm no longer carries enough decided candidates. Kept apart from
   *  CHANGED: "it became something else" and "there is nothing" are different reads. */
  CALIBRATION_RECOMMENDATION_ABSENT: "There is no calibration recommendation to apply right now.",
  /** A role family the app does not define (400). Never a silent global write. */
  CALIBRATION_FAMILY_UNKNOWN: "That isn't one of the app's role families.",
  /** The candidate a match run named does not resolve (400/404) — no profile or
   *  analysis in the caller's workspace behind the id, or a body that named neither.
   *  A decision, not a fault: the recruiter's move is to pick a different candidate,
   *  which is why the focus panel must be able to say THIS rather than "try again". */
  MATCH_INPUT_INVALID: "That candidate could not be resolved. The profile or analysis behind it is gone.",
  /** A market-salary lookup with no role family (400). The band is aggregated per
   *  role family, so there is nothing to answer without one. */
  BENCHMARK_ROLE_FAMILY_REQUIRED: "That benchmark named no role family.",
  // ---- The billing doors (/perfect 2026-09-03, billing-ui). Every refusal here was a
  // bare English sentence, so the tab computed a genuinely actionable reason ("use the
  // portal", "that tier is withdrawn", "you are not an owner") and then discarded it
  // into one generic "Checkout failed". Each now rides as a code the reader resolves in
  // their own language; where the reason names a tier, the NAME travels beside the code
  // as data rather than inside the prose.
  /** The caller holds a seat but not `org:manage` (403). Billing is owner-only by the
   *  role table's own definition; a recruiter or viewer reaching a billing door is a
   *  permissions answer, not a failure. */
  BILLING_ORG_MANAGE_REQUIRED: "Only an owner can manage billing for this organization.",
  /** No POLAR_* env on this deployment (503). Normal on a self-hosted install. */
  BILLING_NOT_CONFIGURED: "Billing is not configured on this deployment.",
  /** A contact-sales tier was posted to checkout (400). `plan` carries its name. */
  BILLING_PLAN_CONTACT_SALES: "That plan is custom-priced. Talk to our sales team to get set up.",
  /** A legacy tier, withdrawn from sale, was posted to checkout (400). Distinct from
   *  the contact-sales refusal on purpose: there is no one to talk to, and the buyer's
   *  real options are a current plan or self-hosting. `plan` carries its name. */
  BILLING_PLAN_WITHDRAWN: "That plan is no longer sold. Pick one of the current plans, or self-host KP for free on your own model keys.",
  /** A plan checkout arrived while a subscription is live (403) — the portal is where
   *  a change happens; a second checkout would mint a parallel subscription. */
  BILLING_ALREADY_SUBSCRIBED: "You already have a plan. Change it in the customer portal (Manage subscription), not with a new checkout.",
  /** A checkout body naming neither a plan nor a pack (400). */
  BILLING_CHECKOUT_BODY_INVALID: "That checkout named neither a plan nor a minutes pack.",
  /** The portal was asked for before any completed checkout (404) — a calm
   *  pre-first-purchase state the tab renders as a hint, not an error. */
  BILLING_NO_CUSTOMER: "No billing customer yet. Complete a checkout first.",
} as const;

export type RefusalErrorCode = keyof typeof REFUSAL_ERRORS;

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

export function safeJsonError(err: unknown, route: string, code: StoreErrorCode, status = 500): NextResponse {
  console.error(`[${route}] ${code}`, err);
  return NextResponse.json({ error: STORE_ERRORS[code], code }, { status });
}
