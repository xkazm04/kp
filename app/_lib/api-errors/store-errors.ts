// Moved out of app/_lib/api-response.ts (re-exported there, so importers are unchanged).
// Pure data: no imports. i18n:check and several contract tests read this file as source text.

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
  JD_DELETE_FAILED: "Could not delete the JD. Please try again.",
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
  // The two /api/analyses doors (/perfect wave 39, lib-analyze). Both sit on
  // better-sqlite3 plus a JSON.parse of a ~21 KB persisted payload, so a thrown message
  // carries SQLITE_* text, the absolute db path or parser detail. They did not FORWARD
  // it (so they were never on the error-response-contract ceiling) — they answered a
  // hand-written English sentence with no code at all, which is the other half of the
  // same defect: History and the report render `body.error`, so a Czech recruiter read
  // "Failed to load analyses." in English at every locale.
  ANALYSES_LIST_FAILED: "Could not load the analysis history. Please try again.",
  ANALYSIS_LOAD_FAILED: "Could not load this analysis. Please try again.",
  ANALYSIS_SAVE_FAILED: "Could not save that change to the analysis. Please try again.",
  // The saved group-evaluation read (/perfect 2026-09-03, group-eval-ui): better-sqlite3
  // plus a JSON.parse of the persisted payload, so the thrown message carries the db path
  // or parser detail. The Decisions modal shows it verbatim, hence the code.
  GROUP_EVAL_READ_FAILED: "Could not load the saved comparison. Please try again.",
  // Cohort Studio (Analyze v2, /api/analyze/cohort*): better-sqlite3 + the payload parse
  // (the read), the row insert + task start (the start), the pool ranking spawn (the
  // proposal). The thrown message carries a db path or a child's stderr.
  COHORT_LOAD_FAILED: "Could not load this comparison. Please try again.",
  COHORT_START_FAILED: "Could not start the comparison. Please try again.",
  COHORT_PROPOSAL_FAILED: "Could not put the comparison together for this role. Please try again.",
  // GET /api/decisions/records: verify + listPipeline can throw SQLITE text and
  // the db path onto an operator JSON body. The sealed Art. 22 dossier.
  DECISION_RECORDS_READ_FAILED: "Could not load decision records. Please try again.",
  // GET /api/decisions/jd-freshness: jdLastEditedAt opens SQLite; a locked DB
  // used to become Next's framework 500 with no code, on the staleness-chip door.
  JD_FRESHNESS_LOOKUP_FAILED: "Could not check when these JDs were last edited. Please try again.",
  // GET /api/decisions/role-view: the per-role decision view (S45) reads the board,
  // the submissions and the scorecards; a locked DB answers this code, not a raw 500.
  ROLE_VIEW_LOOKUP_FAILED: "Could not load this role's candidates. Please try again.",
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
  JOB_PRIORITIES_FAILED: "Could not save the pattern priorities for this role. Please try again.",
  JOB_CAMPAIGN_FAILED: "Could not generate the campaign pack. Please try again.",
  JOB_ASSIGNMENTS_FAILED: "Could not load the work samples for this role. Please try again.",
  JOB_TRANSLATIONS_FAILED: "Could not load this role's postings in other languages. Please try again.",
  JOB_TRANSLATE_FAILED: "Could not translate this posting. Please try again.",
  // The automation clock's control surface (/perfect 2026-09-03, pipeline-board-3).
  // POST here writes the schedule row and can force a full policy pass, so its catch
  // can surface better-sqlite3 constraint text, the db path, and the spawned pass's
  // Python traceback.
  SCHEDULE_UPDATE_FAILED: "Could not update the automation clock. Please try again.",
  // The two automation DOORS beside that clock (/perfect wave 39, lib-automation).
  // Both spawn the Python engine, so their catch surfaces parseStderrError's message —
  // a traceback, argparse usage text, the absolute workdir path, provider stderr — and
  // both were forwarding it whole. Off the error-response-contract ceiling now rather
  // than lowered on it.
  AUTOMATION_TASK_FAILED: "Could not run that AI step for this candidate. Please try again.",
  AUTOMATION_PASS_FAILED: "Could not run the automation pass. Please try again.",
  // POST /api/comms/relay (/perfect 2026-09-03, channels-1). The write encrypts a
  // signing secret and upserts through better-sqlite3, so its catch can surface
  // SQLITE_* text, the absolute db path and the crypto helper's key detail — all of
  // which the handler used to forward as `error.message`.
  COMMS_RELAY_SAVE_FAILED: "Could not save the relay config. Please try again.",
  // GET /api/ops (/perfect wave 17, api-workspace). Its catch forwarded the thrown
  // message for a payload assembled from better-sqlite3 (the db FILE PATH inside a
  // SQLITE_* text), the seed report (absolute seed paths) and three log tails (the
  // log directory) — the widest internal-path leak of any single handler.
  OPS_STATUS_FAILED: "Could not load system status. Please try again.",
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
  INTERVIEW_RESCORE_FAILED: "Could not re-score the interview. Please try again.",
  /** The four verbs of /api/jobs/[id]/interview-kit. All sit on better-sqlite3 (a
   *  JSON.parse of the stored kit included) and the generate door additionally spawns the
   *  Python engine, so a thrown message here carries SQLITE_* text, the absolute db path,
   *  or a traceback off python-runner. */
  INTERVIEW_KIT_FAILED: "Could not load or save this role's interview kit. Please try again.",
  // POST /api/interview/director — the live call's producer channel. The browser never
  // shows this to the candidate: a failed exchange answers the model "continue" and the
  // call goes on (a director outage must never stall an interview).
  INTERVIEW_DIRECTOR_FAILED: "Could not update the interview's progress. The call continues.",
  /** The opt-in audio-recording doors (WP3): the candidate's chunk upload and the
   *  recruiter's playback. Both sit on better-sqlite3 AND the local filesystem, so a
   *  thrown message carries the absolute recordings path and the db path. The upload is
   *  reached by the CANDIDATE's browser mid-call, where a failure must never interrupt
   *  or alter the interview — it is logged here and the call goes on. */
  INTERVIEW_RECORDING_FAILED: "Could not save the interview audio. The interview itself is unaffected.",
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
  /** GET /api/devcase - the approved-case library read. Its catch forwarded the store's
   *  own message (SQLITE_* detail, the absolute db path) to the studio verbatim. */
  DEVCASE_CASE_LIST_FAILED: "Could not load the approved cases. Please try again.",
  /** POST /api/devcase/skill-profile - the credential mint. A store transaction plus an
   *  HMAC sign, both of whose messages `jsonError` used to forward. */
  DEVCASE_SKILL_PROFILE_FAILED: "Could not issue the skill profile. Please try again.",
  /** GET /api/skill-profile/[token]/verify — public FICO-style lookup. A store throw
   *  used to answer jsonError English, which forwarded err.message to whoever holds
   *  the credential URL. */
  SKILL_PROFILE_VERIFY_FAILED: "Could not verify the skill profile. Please try again.",
  // Scheduling & offer public token routes (converted alongside, same class).
  SCHEDULE_INVITE_FAILED: "Could not create the scheduling link. Please try again.",
  SCHEDULE_INVITE_BULK_FAILED: "Could not send the scheduling links. Please try again.",
  SCHEDULE_CONFIRM_FAILED: "Could not confirm that slot. Please try again.",
  // Recruiter invite-lifecycle read (W6-3).
  SCHEDULE_LOOKUP_FAILED: "Could not load the scheduling overview. Please try again.",
  /** POST /api/pipeline/[id]/work-sample — publishing the assignment or writing its letter
   *  faulted. Nothing is claimed as sent. */
  WORK_SAMPLE_SEND_FAILED: "Could not send the work sample. Please try again.",
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
  /** The candidate's own "delete my interview recording" door (public status token).
   *  Its own code, and never a read code: a failed deletion must not read as "we could
   *  not load the page", or the candidate walks away believing the audio is gone. */
  STATUS_RECORDING_DELETE_FAILED: "Could not delete your interview recording right now. Please try again.",
  /** The candidate's "ask for feedback on my interview" door (public status token). Its
   *  own code: a failed request must not read as "we could not load the page", or the
   *  candidate walks away believing they asked. */
  STATUS_LETTER_REQUEST_FAILED: "Could not record your feedback request. Please try again.",
  /** The recruiter's feedback-letter review doors (/api/decisions/feedback-letters/**).
   *  Each sits on better-sqlite3 (and approve on the comms dispatcher), whose thrown
   *  messages carry SQLITE_* text and the db path. One code per door, so a failed
   *  approve never reads as "the list did not load". */
  FEEDBACK_LETTERS_LIST_FAILED: "Could not load the feedback requests. Please try again.",
  FEEDBACK_LETTER_APPROVE_FAILED: "Could not approve this letter. Please try again.",
  FEEDBACK_LETTER_DECLINE_FAILED: "Could not decline this request. Please try again.",
  FEEDBACK_LETTER_REDRAFT_FAILED: "Could not queue a new draft. Please try again.",
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
  // The candidate's own unsubscribe door (public opt-out token route over the pipeline
  // entry + the outreach memory). Read and write get separate codes for the same reason
  // the status/NPS pair does: a failed stop must never read as "we could not load the
  // page", or the candidate walks away believing the mail is stopped when it is not.
  STOP_LOOKUP_FAILED: "Could not load your contact preferences right now. Please try again.",
  STOP_FAILED: "Could not stop the messages right now. Please try again.",
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
  AGENT_HIRE_FROM_NEED_FAILED: "Could not compose and dispatch a role from that need. Please try again.",
  // ADR-0012 — the role slate read (people + AI agents on one board).
  ROLE_SLATE_FAILED: "Could not load this role's candidate slate. Please try again.",
  // ADR-0011 — the role-run gate preview/commit doors.
  ROLE_RUN_GATE_FAILED: "Could not load or record this role-run gate. Please try again.",
  ROLE_RUN_ADVANCE_FAILED: "Could not start or advance this role run. Please try again.",
  // The LLM usage ledger's row-level read (Insights -> Activity). It sits on
  // better-sqlite3, so a thrown message can carry the DB path and the failing SQL;
  // this route was the one door in the Models/Insights surface still forwarding
  // `error.message` straight to the client.
  LLM_ACTIVITY_FAILED: "Could not load the LLM activity ledger. Please try again.",
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
  // Proposal resolution (WP3): COMPANION_PROPOSAL_FAILED stays here (an accident);
  // NOT_FOUND and RESOLVED are decisions and live in REFUSAL_ERRORS below.
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
  // POST /api/decisions/screen-wave: the only Decisions door that queues rejection
  // email. Its catch sat over better-sqlite3 + the comms dispatcher, and used to
  // forward error.message (SQLITE_* / db path) as the client string.
  SCREEN_WAVE_FAILED: "Could not run the screening wave. Please try again.",
  // The analytics WRITE doors (/perfect 2026-09-03, analytics-writes-check-authority).
  // Both sit directly over better-sqlite3 (setChannelSpend / setAnalyticsTarget) and
  // were forwarding `error.message` verbatim — a UNIQUE/CHECK constraint string or the
  // absolute db path, painted into the Economics board in English for every locale.
  /** GET /api/compliance — the workspace’s active jurisdiction + the enforced consent
   *  retention window. It reads the decision-config store’s own SQLite connection, and it
   *  is the route the CANDIDATE-facing AI disclosure calls, so a thrown SQLITE_* message or
   *  db path must never be what a candidate’s browser receives. */
  COMPLIANCE_LOOKUP_FAILED: "Could not load the compliance information. Please try again.",
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
  ANALYTICS_READ_FAILED: "Could not build the analytics. Please try again.",
  ANALYTICS_CALIBRATION_READ_FAILED: "Could not compute the calibration. Please try again.",
  ANALYTICS_SCORE_BAND_READ_FAILED: "Could not load the score band. Please try again.",
  ANALYTICS_THRESHOLD_HISTORY_READ_FAILED: "Could not load the threshold history. Please try again.",
  // The candidate-focus ranking (/api/match, /perfect 2026-09-03). The third route in
  // the matrix family and the last one still answering `{ error: err.message }` — where
  // that message was `parseStderrError`'s RAW STDERR: match_cli's Python traceback and
  // the absolute temp workdir path, forwarded to the browser. Distinct from
  // MATRIX_BUILD_FAILED because the reader is looking at ONE candidate's ranking, not
  // at the grid.
  MATCH_RUN_FAILED: "Could not rank that candidate against the roles. Please try again.",
  // GET/POST /api/archetypes and PUT/PATCH /api/archetypes/[id] (/perfect wave 4,
  // cv-intel). All four catches forwarded `error.message` — registry JSON parse
  // text, the absolute archetypes.json path, and write-rename failures. Distinct
  // from a validation 400 (`errorResponse` already ships code/params): these are
  // store faults the archetype manager must resolve via useErrorMessage.
  ARCHETYPES_READ_FAILED: "Could not load the archetype registry. Please try again.",
  ARCHETYPES_WRITE_FAILED: "Could not save that archetype. Please try again.",
  // The billing doors (/perfect 2026-09-03, billing-ui). All three answered prose with
  // no code: the overview's catch hand-rolled its own `{ error }`, and checkout/portal
  // forwarded the GATEWAY's thrown message — a merchant-of-record HTTP body, i.e. an
  // upstream provider's internals, in an English nobody in the catalog chose.
  BILLING_OVERVIEW_FAILED: "Could not load billing. Please try again.",
  BILLING_CHECKOUT_FAILED: "Could not start the checkout. Please try again.",
  BILLING_WEBHOOK_FAILED: "Could not process the billing event. Please retry the delivery.",
  /** The outbound ATS webhook config write (/perfect 2026-09-03, integrations-settings).
   *  Its 500 forwarded the thrown message, which on this path is better-sqlite3
   *  constraint text, the absolute db path, or an at-rest crypto failure naming the key
   *  env var. */
  ATS_CONFIG_SAVE_FAILED: "Could not save the webhook settings. Please try again.",
  /** The INBOUND connection write / removal (/perfect wave 41, api-ats-integration).
   *  Both catches sat on better-sqlite3 plus the at-rest crypto helper, and the save's
   *  400 branch forwarded every validation message the store and the field map threw —
   *  canonical English into a four-locale panel. The refusals are coded below; these two
   *  are what is left when the failure is genuinely ours. */
  ATS_CONNECTION_SAVE_FAILED: "Could not save the ATS connection. Please try again.",
  ATS_CONNECTION_REMOVE_FAILED: "Could not remove the ATS connection. Please try again.",
  BILLING_PORTAL_FAILED: "Could not open the customer portal. Please try again.",
  /** The merchant of record accepted the request and then said nothing until the
   *  gateway's AbortSignal budget (POLAR_REQUEST_TIMEOUT_MS) ran out — answered at 504,
   *  not 502, because nothing was refused and the advice is genuinely "try again".
   *  A store error by classification: the raw abort names our own internals. */
  BILLING_PROVIDER_TIMEOUT: "The payment provider did not respond in time. Please try again in a moment.",
  /** The guided simulation's five routes (/perfect wave 16, guided-simulation-1). All
   *  sit on better-sqlite3 — the reset runs a DELETE transaction over four tables — and
   *  the console that reads them is the PUBLIC demo, so a thrown message would be both
   *  a leak and English prose in an otherwise localized tour. */
  SIM_RESET_FAILED: "Could not clear the simulation data. Please try again.",
  SIM_INBOUND_FAILED: "Could not simulate the incoming application. Please try again.",
  SIM_SCREEN_DRAFT_FAILED: "Could not prepare the screening recommendation. Please try again.",
  SIM_OFFER_DRAFT_FAILED: "Could not prepare the offer draft. Please try again.",
  SIM_OFFER_LINK_FAILED: "Could not read the offer link. Please try again.",
  // /api/sim/apply-cv's catch (/perfect wave 22, api-guided-simulation): it forwarded
  // the thrown message through jsonError, and ingestCvApplication sits on
  // better-sqlite3 AND the spawned matcher — SQLITE_* constraint text, the absolute
  // db path, a Python traceback. Its four sibling sim routes were already coded.
  SIM_CV_INTAKE_FAILED: "Could not file that simulated application. Please try again.",
  /** The background-task dock (/perfect wave 17, background-tasks). All three of
   *  these 500s forwarded the thrown message, which on this path is better-sqlite3
   *  detail plus the absolute db path — and the dock renders whatever it is handed,
   *  in every locale. */
  TASK_LIST_FAILED: "Could not load the AI tasks. Please try again.",
  TASK_START_FAILED: "Could not start that AI task. Please try again.",
  TASK_RETRY_FAILED: "Could not re-run that AI task. Please try again.",
  /** The live work-surface session mint's catch (/perfect wave 23,
   *  devcase-candidate-and-devcase). It forwarded the thrown message from a PUBLIC
   *  candidate door sitting straight on better-sqlite3 — SQLITE_* codes and the
   *  absolute db path, painted at an applicant in whatever language the server
   *  happened to speak. */
  DEVCASE_SESSION_START_FAILED: "Could not open the work session. Please try again.",
  /** The two inbound-receiver writes on the Channels tab (/perfect wave 27, api-comms).
   *  Both sat straight on better-sqlite3 + the pull-config encryptor and forwarded the
   *  thrown message, so a UNIQUE-constraint string and the absolute db path were what
   *  the Add-receiver modal painted, in every locale. */
  CHANNEL_WEBHOOK_CREATE_FAILED: "Could not create the receiver. Please try again.",
  CHANNEL_WEBHOOK_UPDATE_FAILED: "Could not update the receiver. Please try again.",
  /** POST /api/channels/inbound/[token] — the PUBLIC, session-less lead webhook: the
   *  only credential is the channel token, so its caller is unauthenticated. Its 500
   *  catch forwarded the thrown message whole, and the path sits on better-sqlite3 plus
   *  a spawned CV extractor (ingestCvApplication), so that message carries SQLITE_*
   *  constraint text, the absolute db path and Python tracebacks to whoever POSTed. Its
   *  siblings /api/apply and /api/agents/report/[token] already answer via safeJsonError;
   *  this closes the last public-webhook leak of the same class. */
  CHANNEL_INBOUND_FAILED: "Lead intake failed. Please try again.",
  /** The two organization-backup handlers (/perfect wave 37, lib-infra-runtime).
   *  Both sat straight on better-sqlite3 and forwarded the thrown message, so a
   *  SQLITE_* code and the absolute db path were what the Backup panel painted. */
  WORKSPACE_EXPORT_FAILED: "Could not build the organization backup. Please try again.",
  WORKSPACE_RESTORE_FAILED: "Could not restore the organization backup. Please try again.",
  /** The white-label brand door (/perfect wave 38, brand-theming). Both handlers sit
   *  straight on better-sqlite3 (a lazily-created table in an isolated store), so the
   *  thrown message carries SQLITE_* text and the absolute db path — which the save
   *  handler used to answer with an English sentence of its own and the Branding tab
   *  rendered verbatim in every locale. */
  BRAND_LOAD_FAILED: "Could not load branding. Please try again.",
  BRAND_SAVE_FAILED: "Could not save branding. Please try again.",
  /** The profile SAVE door and the matrix read behind it. Both sit on better-sqlite3
   *  (SQLITE_* text + the absolute db path) and the save additionally spawns
   *  profile_cli, whose failures carry the temp workdir path and PYTHON_CMD — all of
   *  which the five handlers used to answer with, verbatim, in every locale. */
  PROFILE_LIST_FAILED: "Could not load your saved profiles. Please try again.",
  PROFILE_BUILD_FAILED: "Could not build that profile. Please try again.",
  PROFILE_UPDATE_FAILED: "Could not save your changes to that profile. Please try again.",
  PROFILE_DELETE_FAILED: "Could not delete that profile. Please try again.",
  PROFILE_CANDIDATES_FAILED: "Could not load the candidate matrix. Please try again.",
  /** POST /api/profile/draft — the drafting door beside them, and the last of the
   *  family still answering prose with no code at all. It spawns profile_draft_cli,
   *  so the thrown message carries a Python traceback, the temp workdir path and
   *  provider stderr; both the recruiter's notes panel and the seeker's CV import
   *  read it, and neither could localize a sentence. */
  PROFILE_DRAFT_FAILED: "Could not turn that text into a profile. Please try again.",
  /** The text extractor faulted (500): a non-zero exit with no client-fixable code, a
   *  wedged workdir, an ENOENT on PYTHON_CMD, or non-JSON stdout — whose diagnostic
   *  dump embeds stdout, stderr and the temp workdir path by construction. */
  EXTRACT_TEXT_FAILED: "Could not read text from that file. Please try again.",
  // ---- The last two candidate doors of the work session (/perfect wave 42a,
  // devcase-identity-and-lifecycle). The chat channel, the 8s flush and the
  // recruiter read that shares their URL prefix all answered jsonError, which
  // forwards the thrown .message: SQLITE_* codes, the absolute db path and the
  // provider stderr runSessionChat raises, painted at an unauthenticated
  // applicant mid-assessment.
  /** The chat channel faulted (500): better-sqlite3 on the transcript write, or the
   *  spawned model call. The candidate keeps working; the message was not sent. */
  DEVCASE_CHAT_FAILED: "Could not reach the chat channel. Please try again.",
  /** The 8s flush faulted (500). Its message must never read as lost work: the
   *  surface keeps the batch buffered and the local draft on the device. */
  DEVCASE_SESSION_FLUSH_FAILED: "Could not save this work session right now. Your work is kept on this device and will be sent again.",
  /** The recruiter read of a work session faulted (500). Operator-facing, but it
   *  sits under the public session prefix and shared the candidate responder. */
  DEVCASE_SESSION_READ_FAILED: "Could not load the work session. Please try again.",
  /** Job-seeker module: a store-backed read/write on the seeker's own profile, sources,
   *  postings or dialogs faulted (500). One code for the whole module — the seeker's
   *  next step (retry) is the same whichever table broke, and which one is operator
   *  detail for the log. */
  JOBSEEKER_STORE_FAILED: "Could not save or load your job search right now. Please try again.",
  /** POST /api/billing/alerts/[id]: the store faulted while closing a billing alert (500). */
  BILLING_ALERT_RESOLVE_FAILED: "Could not update the billing alert. Please try again.",
  /** POST /api/ats/import: the store faulted while filing or linking a vendor record
   *  (500). The refusals the import can make are coded in REFUSAL_ERRORS. */
  ATS_IMPORT_FAILED: "Could not import the ATS applications. Please try again.",
  /** GET /api/pipeline/[id]/offer-letter: the store or the letter composer faulted while
   *  rendering the read-only offer letter preview (500). */
  OFFER_LETTER_PREVIEW_FAILED: "Could not render the offer letter preview. Please try again.",
  /** POST /api/status/[token]/resend: the store or the comms dispatcher faulted while
   *  re-sending the candidate's pending link (500). Public token door: never the raw message. */
  STATUS_RESEND_FAILED: "Could not send the link again. Please try again.",
  /** GET/POST /api/voice/readiness: the store or the probe bookkeeping faulted while
   *  building the operator's voice-provider readiness (500). A provider's own mint
   *  failure is never this: it is a row verdict ("broken" with a cause). */
  VOICE_READINESS_FAILED: "Could not load voice readiness. Please try again.",
  /** POST /api/stop/[token]/language: the store faulted while saving the candidate's
   *  chosen letter language (500). Public token door: never the raw message. */
  STOP_LANGUAGE_FAILED: "Could not save your language right now. Please try again.",
  /** POST /api/devcase/[id]/intake: the store faulted while closing the case's open
   *  postings (500). The lifecycle-owns refusal is a decision, coded in REFUSAL_ERRORS. */
  DEVCASE_INTAKE_STOP_FAILED: "Could not stop intake for this assignment. Please try again.",
  /** Gigs module (/api/gigs/**): a store-backed read/write on the workspace's gigs,
   *  attempts, outcomes, sources, specialists or lessons faulted (500). One code for the
   *  module, like JOBSEEKER_STORE_FAILED: the operator's next step is the same whichever
   *  table broke. */
  GIG_STORE_FAILED: "Could not save or load your gigs right now. Please try again.",
} as const;

export type StoreErrorCode = keyof typeof STORE_ERRORS;
