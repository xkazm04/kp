// Moved out of app/_lib/api-response.ts (re-exported there, so importers are unchanged).
// Pure data (its one import is the shared rate-limit sentence). i18n:check and several contract tests read this file as source text.
import { RATE_LIMITED_ERROR } from "../rate-limit";

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
  /** Unsupported activity filter or malformed keyset cursor (400). */
  LLM_ACTIVITY_QUERY_INVALID: "That activity filter or cursor is not valid.",
  /** Uniform for an unknown email, wrong user password, and wrong operator password (401). */
  LOGIN_CREDENTIALS_INVALID: "Incorrect credentials. Try again.",
  /** The automation task in the URL is not one the engine knows (404). The board only
   *  ever names a real one, so reaching this means a hand-rolled call. */
  AUTOMATION_TASK_UNKNOWN: "That automation step does not exist.",
  /** The task named an entry that is not on this team's board (404). */
  AUTOMATION_ENTRY_NOT_FOUND: "That candidate is not on this board.",
  /** …or one with no usable candidate profile behind it (400): the entry carries no
   *  profile id, or the profile it points at is gone. Deliberately ONE refusal for
   *  both — the recruiter's next step (re-run the analysis for this person) is the
   *  same either way, and which of the two broke is operator detail for the log. */
  AUTOMATION_ENTRY_NO_PROFILE: "This candidate has no analyzed profile yet, so there is nothing for the AI to read.",
  /** The POST arrived without an entry to act on (400). */
  AUTOMATION_ENTRY_REQUIRED: "Name the candidate this step should run for.",
  /** GET /api/pipeline/rejected arrived without the board lane to list (400). */
  PIPELINE_LANE_REQUIRED: "Name the position whose rejected candidates to list.",
  /** GET /api/pipeline/events/recent?since= carried a cursor that is not an event id (400). */
  PIPELINE_EVENTS_CURSOR_INVALID: "The activity cursor is not valid.",
  /** GET /api/interview/sessions/[id]: no such session on this team (404). */
  INTERVIEW_SESSION_NOT_FOUND: "That interview isn't on this team's record.",
  /** A recruiter asked for an AI action the candidate's column does not offer (409) —
   *  the workspace's per-step list in Settings → Hiring, or the product default. */
  AUTOMATION_TASK_NOT_OFFERED: "That AI action isn't available at this candidate's step.",
  /** POST /api/automation/run carried an `approved` selection that is not a list of
   *  reviewed advance/reject rows within the pass's entry cap (400). The preview modal
   *  only ever sends a well-formed one, so reaching this means a hand-rolled call. */
  AUTOMATION_SELECTION_INVALID: "That selection of changes could not be read. Preview the pass again and re-apply.",
  /** POST /api/devcase/source carried a candidate selection that is not a non-empty list of candidate ids (400). */
  DEVCASE_SOURCE_SELECTION_INVALID: "That candidate selection could not be read. Preview the matches again and re-apply.",
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
  /** The accept/decline POST arrived with neither verb (400). The card only ever
   *  sends one of the two, so reaching this means a hand-rolled call — and the
   *  candidate still deserves the reason in their own language rather than the
   *  server's English sentence. */
  OFFER_RESPONSE_INVALID: "Respond with either accept or decline.",
  /** A status link that resolves to no application (404) — mistyped, revoked, or
   *  belonging to an entry that has since been erased. `not found` in bare English
   *  was what the two public status doors answered; the page shows the reader
   *  `errors.STATUS_LINK_INVALID` in their own language instead. The token and the
   *  entry stay DELIBERATELY indistinguishable: one refusal for both, so the door
   *  is not an existence oracle. */
  STATUS_LINK_INVALID: "This status link is not valid.",
  /** Feedback arrived for an application that is still running (409). Refused
   *  rather than stored: a response captured mid-process would be folded into a
   *  "candidate experience" figure that claims to measure completed journeys. */
  STATUS_NPS_NOT_APPLICABLE: "This question opens once your application has finished.",
  /** A feedback-letter request for an application where none may be asked (409): no
   *  decision yet, a decision no person made about this candidate (an automated screen-out,
   *  a closed role), no interview on record, or consent withheld. ONE code for all of them,
   *  on purpose: the public door must not become a way to learn which one applies. */
  STATUS_LETTER_NOT_ELIGIBLE: "Written feedback on your interview is not available for this application.",
  /** A second feedback-letter request for the same application (409). The response carries
   *  the existing request's state beside the code (`letter`), so a repeated click still
   *  shows the candidate where their one request stands — never a second letter. */
  STATUS_LETTER_ALREADY_REQUESTED: "You have already asked for feedback on this interview.",
  /** A feedback letter id that does not resolve in the caller's team (404), or whose
   *  application is gone. One answer for both: a foreign id is not an existence oracle. */
  FEEDBACK_LETTER_NOT_FOUND: "This feedback request no longer exists.",
  /** The letter is no longer open (409): someone approved or declined it, or an erasure
   *  closed it, between the read and this write. The response carries the letter's
   *  current `state` beside the code. Nothing was written. */
  FEEDBACK_LETTER_MOVED: "Someone already decided on this feedback request. Reload the list to see where it stands.",
  /** The candidate's consent is withheld (expired, not yet anonymized) (409). No letter
   *  is written or drafted about a person whose consent lapsed; a decline still closes it. */
  FEEDBACK_LETTER_CONSENT_WITHHELD: "This candidate's consent has lapsed, so the letter can no longer be written or sent. Decline the request to close it.",
  /** Approve with an empty final text (400). */
  FEEDBACK_LETTER_TEXT_EMPTY: "Write the letter before approving it.",
  /** Approve with a final text over LETTER_MAX_CHARS (400). The cap rides beside the code
   *  as `maxChars`; the letter is never truncated to fit. */
  FEEDBACK_LETTER_TEXT_TOO_LONG: "The letter is longer than the limit. Shorten it before approving it.",
  /** Public NPS POST with no score at all (400). parseNpsSubmission used to put
   *  the English sentence "score is required" on the wire; the status page
   *  localizes `errors.NPS_SCORE_REQUIRED` instead. */
  NPS_SCORE_REQUIRED: "A score is required.",
  /** Public NPS POST whose score is not an integer in 0..10 (400). One code for
   *  both "not a whole number" and "out of range" — the candidate's next step is
   *  the same (pick a 0-10), and the validator must not coerce. */
  NPS_SCORE_INVALID: "Score must be a whole number from 0 to 10.",
  /** An erasure link that resolves to nothing (404): never issued, or already
   *  spent — anonymizeEntry NULLs the token, so a replay lands here. Both readings
   *  share one refusal because the candidate's next step is the same either way,
   *  and telling them apart would confirm which tokens exist. */
  DATA_LINK_INVALID: "This data link is no longer valid.",
  /** An unsubscribe link that resolves to nothing (404): never issued, already spent by
   *  an erasure (anonymizeEntry NULLs the token), or simply not a token we minted. All
   *  readings share ONE refusal, exactly as DATA_LINK_INVALID and STATUS_LINK_INVALID
   *  do: telling "no such token" apart from "no such entry" would make the door an
   *  existence oracle over a set of tokens that name real people, and the candidate's
   *  next step is identical either way. */
  STOP_LINK_INVALID: "This unsubscribe link is no longer valid.",
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
  /** The work session has spent its 400-message ceiling (429). A THIRD kind of 429 and
   *  deliberately not TOO_MANY_REQUESTS: the shared throttle's sentence promises that
   *  waiting clears it, and this ceiling never resets for the session, so the shared
   *  code would tell a candidate mid-assessment to do the one thing that cannot help.
   *  Their work is already stored, which is the part the message has to carry. */
  DEVCASE_CHAT_CEILING: "This work session has used all of its messages. Your work is saved, and this budget does not reset.",
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
  /** A profile save was computed against a version of the row that someone else has
   *  since replaced (409). The editor spans a Python spawn, so its form is minutes
   *  older than the row by the time the UPDATE runs; updateProfile re-asserts the
   *  caller's `expectedUpdatedAt` in the WHERE and a zero-row result lands here. Not a
   *  fault, and never a 404: the profile exists, it simply moved, and the honest answer
   *  is "reload" rather than a silent last-write-wins over the other writer's work. */
  PROFILE_STALE: "This profile was saved by someone else after you opened it. Reload it and re-apply your changes.",
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
  /** Comparison requires a role id (400). */
  INTERVIEW_JOB_REQUIRED: "Choose a role to compare interviews.",
  /** Practice attachment requires both a run token and destination candidate (400). */
  INTERVIEW_SIM_ATTACH_FIELDS_REQUIRED: "Choose a practice interview and candidate to attach it to.",
  /** No completed practice run with this token belongs to the caller's team (404). */
  INTERVIEW_SIM_SESSION_NOT_FOUND: "That practice interview is not available.",
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
  INTERVIEW_NOT_RESCORABLE: "This interview is not eligible for re-scoring.",
  /** A re-score whose scorecard carries no reasons (409): no key, the model was down,
   *  or every quote failed grounding. Nothing was attached; the session stays unscored. */
  INTERVIEW_SCORECARD_UNGROUNDED: "The scorer could not ground a verdict in the transcript, so nothing was saved. Try the re-score again later.",
  /** A second /connect on a link whose call is already LIVE (409). The token IS
   *  the session, so two tabs (or a forwarded link) both minted provider
   *  credentials and both ran a real conversation — and the loser's transcript was
   *  discarded at hang-up behind a green "saved". `retryAfterMin` rides alongside:
   *  the live window is LIVE_INTERVIEW_RECENCY_MIN, after which an abandoned
   *  session is re-dialable. */
  INTERVIEW_ALREADY_LIVE:
    "This interview is already running in another window. Finish or close it before starting again.",
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
  /** The director was called for a session that is not the LIVE call it names (409):
   *  a link never connected (`created`), a dropped call awaiting its reconnect
   *  (`failed`), or an `attempt` other than the session's current one — a stale tab of
   *  an earlier connect. Completed and revoked sessions keep their own codes. */
  INTERVIEW_NOT_LIVE: "This interview isn't running right now.",
  // ---- Opt-in audio recording (WP3). Every one of these is answered to the
  // CANDIDATE'S OWN BROWSER mid-call, which is why they are coded rather than prose:
  // the portal was opened from an invite written in their language. None of them is
  // ever shown as an interruption — the hook simply stops recording (state "failed")
  // and the interview continues, because an observation aid must never be able to
  // damage the thing it observes.
  /** Audio arrived for a workspace that does not offer recording, or for a session
   *  whose candidate never gave the separate audio consent (403). ONE refusal for both:
   *  "we are not keeping audio for this call" is the whole fact, and which half of it
   *  applies is operator detail. */
  INTERVIEW_RECORDING_NOT_OFFERED: "This interview is not being recorded.",
  /** Audio arrived for a call that is not running and is past the final-flush window —
   *  a link never connected, one the recruiter revoked, or a call that ended minutes
   *  ago (409). */
  INTERVIEW_RECORDING_CLOSED: "This interview is no longer accepting audio.",
  /** The chunk's content type is not one of the container formats a browser's recorder
   *  produces (415). The file name's extension comes from this allow-list, so anything
   *  outside it has nowhere to be stored. */
  INTERVIEW_RECORDING_TYPE_UNSUPPORTED: "That audio format can't be stored.",
  /** This interview's audio budget is spent (413). The recording so far is KEPT and
   *  marked partial — what was captured stays, and the recruiter is told it is
   *  incomplete rather than shown nothing. */
  INTERVIEW_RECORDING_FULL: "This interview has stored all the audio it can hold.",
  /** No such recording on this team's record (404) — never uploaded, already deleted,
   *  past its retention window, or belonging to another workspace. All four share one
   *  refusal on purpose: distinguishing them would make the door an oracle for which
   *  candidates were recorded. */
  INTERVIEW_RECORDING_NOT_FOUND: "That interview recording is no longer available.",
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
  /** A job-posting id does not resolve in this workspace (404). */
  POSTING_NOT_FOUND: "That job posting could not be found.",
  /** A URL import reached the page but got no readable text back, or the fetch failed (502). */
  POSTING_FETCH_FAILED: "The page could not be fetched or did not contain readable text.",
  /** A paste/URL import carried fewer than the minimum characters of body text (400). */
  POSTING_TEXT_REQUIRED: "The posting needs at least a few paragraphs of text.",
  /** KP_OFFLINE seals egress, so a URL import is refused up front rather than failing inside fetch (503). */
  POSTING_OFFLINE: "This server runs offline, so a page cannot be fetched. Paste the text instead.",
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
  /** The install's edge pairing belongs to a different organization (403, nothing
   *  written) — F-3. `edge_config` is one install-level row, so `org:manage` in ANY org
   *  used to be enough to re-point, unpair or re-key the transport every organization's
   *  inbound depends on. An AUTHORIZATION answer, not a bad field: no edit of the request
   *  fixes it. The two org ids go to the server log, never to the reader. */
  EDGE_OWNED_BY_OTHER_ORG: "This install's edge pairing belongs to another organization. Only that organization can change it.",
  /** Publishing the sealing key did not happen (400) — usually because no edge is
   *  paired yet, or it did not answer. Nothing was rotated; retrying is safe. */
  EDGE_PAIR_REFUSED: "Could not publish the sealing key to the edge. Check the pairing and try again.",
  /** The stored edge credential cannot be decrypted on this install (409) - the
   *  master key was rotated ahead of `secrets:rotate`, or the retired key was
   *  dropped. A DECISION, and an actionable one: nothing drains until the secret is
   *  re-entered or the key restored, and the drain says so instead of 500-ing. */
  EDGE_SECRET_UNREADABLE: "This install cannot read the stored edge secret. Re-enter it, or restore the key it was encrypted with.",
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
  /** An accept/reject whose decision record could not be sealed (503). The seal is
   *  the PRECONDITION of the write (pipeline-entry-action.ts, the screen-wave.ts rule:
   *  no seal, no rejection), so nothing happened: the candidate kept their step, no
   *  letter went out and no ATS event fired. The fresh entry rides alongside in
   *  `entry`. A server condition, not a business rule — retrying once the decision
   *  chain is writable is the remedy. */
  PIPELINE_DECISION_NOT_SEALED: "This decision couldn't be recorded, so it was not applied. Nothing changed and nothing was sent. Try again shortly.",
  /** A reject on a candidate who is already hired (409): the entry stands on the
   *  terminal step, so rejecting would run the whole reject path on an accepted offer.
   *  Nothing was sealed, sent or changed. Rescinding a hire is a separate action. */
  PIPELINE_ENTRY_HIRED: "This candidate is already hired, so they can't be rejected. Nothing changed.",
  /** A body naming an action this board does not have (400). */
  PIPELINE_ACTION_UNKNOWN: "That is not an action this board supports.",
  /** A GitHub evidence payload that did not clamp to the shared coercer (400). */
  PIPELINE_GITHUB_EVIDENCE_INVALID: "That GitHub evidence is not in the expected shape.",
  /** A Match add's verdict facts are missing, outside the closed vocabularies or the
   *  bounds (app/_lib/match-verdict.ts), disagree with the score being filed, or ride
   *  a non-Match add — or the add carried the retired prose `reasons` fields (400).
   *  Nothing was sealed and nothing was filed. */
  PIPELINE_ADD_REASONS_INVALID: "The reasons attached to this add are not in the expected shape.",
  /** A Match add naming no stored Match result the server can use (409): no run id, a run
   *  that expired (12h), one from another workspace, or one for a different candidate or
   *  role. Nothing was sealed and nothing was filed; run Match again for this candidate. */
  PIPELINE_ADD_MATCH_RUN_UNKNOWN: "This match result is no longer available to file from. Run Match again for this candidate, then add.",
  /** A Match add whose score, tier, strongest/weakest dimension, skills or scorer version
   *  differ from the result the server holds for its run (409). Nothing was sealed and
   *  nothing was filed. */
  PIPELINE_ADD_MATCH_RUN_MISMATCH: "This add does not match the result Match produced, so it was not filed. Run Match again for this candidate, then add.",
  /** A Match add whose verdict could not be sealed into the decision chain (503). The
   *  seal is the PRECONDITION of the insert (ADR 0018, the ADR 0017 rule: no record, no
   *  write), so the candidate was not filed. A server condition — retry once the chain
   *  is writable. */
  PIPELINE_ADD_NOT_SEALED: "This candidate couldn't be added because the match verdict couldn't be recorded. Nothing was filed. Try again shortly.",
  /** A board add cannot identify both its candidate and role (400). */
  PIPELINE_ADD_IDS_REQUIRED: "Choose a candidate and role before adding to the board.",
  /** The requested destination is not on this workspace's pipeline axis (400). */
  PIPELINE_ADD_STAGE_UNKNOWN: "That pipeline stage is not available in this workspace.",
  /** Only the decision gate may be requested when adding a candidate (400). */
  PIPELINE_ADD_APPROVAL_KIND_UNKNOWN: "That approval kind cannot be requested when adding a candidate.",
  /** A rediscovery/sourcing re-surface naming a person who opted out, whose consent
   *  lapsed, or who was erased (409). The reason rides alongside in `withheld`. */
  PIPELINE_ADD_CANDIDATE_WITHHELD: "This person can't be re-surfaced for a new role: they opted out, their consent lapsed, or their data was erased.",
  /** `notes` arrived as something other than text (400). */
  PIPELINE_NOTES_INVALID: "A candidate note must be text.",
  /** …or past the column's ceiling (400). The cap rides alongside in `max`. */
  PIPELINE_NOTES_TOO_LONG: "That note is too long to save.",
  /** A thread note (add_note) was empty after trimming (400). */
  PIPELINE_NOTE_EMPTY: "Write something before adding a note.",
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
  /** An offer draft whose figure is present but cannot be a salary — negative, or
   *  past the stated ceiling (400). Refused BEFORE a token is minted, so no letter
   *  goes out and no decision is sealed. The bound rides along as `max`.
   *  (offer-policy.validateOfferTerms) */
  OFFER_SALARY_INVALID: "That offer amount isn't a salary we can send — check the figure before extending.",
  /** An offer draft denominated in a currency outside the closed list
   *  (offer-policy.OFFER_CURRENCIES) (400). `max` carries the size of that list. */
  OFFER_CURRENCY_UNSUPPORTED: "That currency isn't one an offer can be made in here.",
  /** The offer draft's free-text terms note is over OFFER_NOTES_MAX_CHARS (400).
   *  The cap rides along as `max`. */
  OFFER_NOTES_TOO_LONG: "That offer note is too long to send — shorten it and extend again.",
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
  // ---- The RECRUITER's LIFECYCLE actions on the same route (/perfect 2026-09-03,
  // schedule-ui-2). The book path above was moved onto codes in wave 7; the twelve
  // OTHER branches of POST/PATCH /api/schedule — cancel, no-show, reschedule,
  // accept/decline a proposal, reconcile, the meeting link — were left answering bare
  // English. The lifecycle panel resolves by code and correctly ignores prose, so every
  // one of them collapsed into the panel's generic "That action didn't go through."
  // toast: a recruiter whose candidate proposed times that have since passed and one
  // who clicked cancel on an already-cancelled row read the identical sentence.
  /** `action` was missing from the recruiter POST body (400). A stale bundle or a
   *  hand-rolled call; nothing was read or written. */
  SCHEDULE_ACTION_REQUIRED: "No scheduling action was named.",
  /** The named action is not one this route performs (400). */
  SCHEDULE_ACTION_UNKNOWN: "That scheduling action isn't one this app performs.",
  /** A grid book arrived without an entry id or a target cell (400). */
  SCHEDULE_BOOK_TARGET_MISSING: "Pick a candidate and a time before booking.",
  /** A lifecycle action arrived without an invite token (400). */
  SCHEDULE_TOKEN_REQUIRED: "That interview link is missing — reload the tab and try again.",
  /** No invite for this token on THIS team's calendar (404). The recruiter route is
   *  workspace-authenticated, so a foreign token is indistinguishable from a deleted
   *  one — deliberately, and the remedy is the same reload either way. */
  SCHEDULE_INVITE_NOT_FOUND: "That interview is no longer on your calendar. Reload the tab.",
  /** Cancel arrived for an invite with no confirmed booking (409) — the panel is a
   *  snapshot and the row moved (a candidate rescheduled, another operator cancelled). */
  SCHEDULE_CANCEL_NOT_CONFIRMED: "Only a confirmed booking can be cancelled. Reload to see where this one stands.",
  /** No-show arrived for an invite with no confirmed booking (409). */
  SCHEDULE_NO_SHOW_NOT_CONFIRMED: "Only a confirmed booking can be marked as a no-show. Reload to see where this one stands.",
  /** A recruiter reschedule arrived for an invite that holds no booking (409) — there
   *  is nothing to move; the remedy is a fresh invite, not a retry. */
  SCHEDULE_RESCHEDULE_NOT_CONFIRMED: "Only a confirmed booking can be moved. Send a new scheduling link instead.",
  /** The accepted time is no longer among the candidate's proposals (409): they
   *  replaced them, or another operator already accepted or declined the set. */
  SCHEDULE_PROPOSAL_GONE: "That proposed time is no longer on the invite. Reload to see the current proposals.",
  /** The proposal is structurally valid but has aged into the past (409). Not a
   *  retryable fault: the candidate has to suggest new times. */
  SCHEDULE_PROPOSAL_EXPIRED: "That proposed time has passed. Ask the candidate to suggest new times.",
  /** Decline-all arrived on an invite carrying no proposals (409). */
  SCHEDULE_NO_PROPOSALS: "There are no proposed times to decline.",
  /** Resolve arrived on an invite with no reconcile flag set (409) — already resolved,
   *  usually by another operator or by a re-book that cleared it. */
  SCHEDULE_NOTHING_TO_RECONCILE: "There's nothing left to reconcile on this interview.",
  // ---- The BULK invite door (/perfect wave 40, lib-scheduling). This route answered
  // English sentences to a localized board: one whole-request 400 built by hand, and
  // four PER-ENTRY prose strings ("not found", "not active", "mint failed", "over the
  // 100-candidate cap") pushed into `results[]`. The bulk bar already reads a per-item
  // CODE the same way it reads the batch route's — it just never received one, so every
  // refused row collapsed into a single generic "some couldn't be invited" line with no
  // reason a recruiter could act on.
  /** The bulk POST carried no usable entry ids at all — an empty selection, or a body
   *  that was not an array of ids (400). Nothing was minted or sent. */
  SCHEDULE_BULK_NO_ENTRIES: "Select at least one candidate before sending scheduling links.",
  /** A per-entry row naming a candidate this team's board does not hold (404-ish, per
   *  entry): deleted, or filed under another workspace. The row stays selected. */
  SCHEDULE_BULK_ENTRY_NOT_FOUND: "That candidate is no longer on this board. Reload and try again.",
  /** A per-entry row for a candidate who is hired, rejected or withdrawn. Never invite a
   *  terminal candidate — the same stale-token doctrine the single flows enforce. */
  SCHEDULE_BULK_ENTRY_INACTIVE: "That candidate is no longer active, so no scheduling link was sent.",
  /** A per-entry row whose invite could not be minted (the store threw). One entry's
   *  fault never aborts the batch, and the reason it carries back must be a code, not a
   *  better-sqlite3 message. */
  SCHEDULE_BULK_MINT_FAILED: "Couldn't create a scheduling link for this candidate. The rest of the batch was unaffected.",
  /** A per-entry row past the per-request cap. It is reported rather than silently
   *  dropped so it stays selected and the recruiter can send the next batch; the cap
   *  rides alongside in `max`. */
  SCHEDULE_BULK_OVER_CAP: "Too many candidates for one send, so this one was not invited. Send the rest in a second batch.",
  /** A per-entry row whose resolved recipient is a display name, an opaque id, or
   *  the literal "candidate" — a relay would dead-letter it. Refused before mint so
   *  the row stays selected and no orphan schedule token is created. */
  SCHEDULE_BULK_UNADDRESSABLE: "This candidate has no email address, so no scheduling link was sent.",
  // ---- The SINGLE invite door (/perfect wave 40, scheduling-and-interview-prep).
  // Its bulk sibling was migrated one wave earlier; this door still answered three
  // hand-built English sentences, and the third of them reached the recruiter panel
  // verbatim - useScheduleInviteLifecycle resolves `code` and, finding none, painted
  // its own generic "action failed" over a refusal whose reason IS the remedy.
  /** The mint POST carried no entryId (400). Nothing was minted or mailed. */
  SCHEDULE_INVITE_ENTRY_REQUIRED: "Pick a candidate before creating a scheduling link.",
  /** The linked candidate is hired, rejected or withdrawn (409). Both UI gates on this
   *  door read a CLIENT-side snapshot, so a drawer left open while the candidate was
   *  closed out in another tab used to mint a link AND mail an interview invitation. */
  SCHEDULE_INVITE_ENTRY_INACTIVE: "That candidate is no longer active, so no invite was sent.",
  /** POST /api/pipeline/[id]/work-sample (409): the candidate was closed out (rejected,
   *  withdrawn) — read off the server row, not the drawer's snapshot. Nothing was sent. */
  WORK_SAMPLE_ENTRY_INACTIVE: "That candidate is no longer active, so no work sample was sent.",
  /** The submitted meeting link is not http(s), or does not parse (400). The link is
   *  rendered as a trusted "Join" anchor and baked into calendar events, so anything
   *  else is refused rather than sanitized. */
  SCHEDULE_MEETING_URL_INVALID: "Enter a valid http(s) meeting link.",
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
  /** The salary currency submitted for the organization is not one the app offers
   *  (400). A bad argument, kept apart from ORG_SETTINGS_FORBIDDEN for the same
   *  reason as the language code above. */
  ORG_CURRENCY_INVALID: "That isn't one of the currencies the app offers.",
  /** The matrix scorer refused the request itself (4xx) — a corpus/profile the grid
   *  asked for that the engine will not score. Not a fault, so it is not withheld: the
   *  recruiter's move is to reload or narrow the scope, not to report a crash. */
  MATRIX_INPUT_INVALID: "The fit matrix could not be built from that request.",
  /** The (candidate, role) pair behind a clicked cell no longer resolves (400/404) —
   *  a profile deleted, or a role that left the corpus, between the grid being scored
   *  and the cell being opened. Distinct from MATCH_REASONING_FAILED, which is the
   *  engine falling over: this one is answered by refreshing the grid. */
  MATCH_REASONING_UNAVAILABLE: "That match can no longer be explained — the candidate or role behind it is gone.",
  /** The reasoning request was MALFORMED rather than stale (400) — it named no job,
   *  or no candidate the resolver could even look up. Distinct from
   *  MATCH_REASONING_UNAVAILABLE, which means the pair was named and is gone: the
   *  remedy there is "refresh the grid", here it is "open the cell again". Both codes
   *  are reached from the RUNNER's own code (reasoning-run.ts stamps not_found /
   *  invalid_input at every throw site), not from the HTTP status. */
  MATCH_REASONING_INPUT_INVALID: "That match could not be explained: the request named no candidate, or no role.",
  /** A decision-rules write with no phase or no config in the body (400). */
  DECISION_CONFIG_FIELDS_REQUIRED: "That rules update named no phase, or carried no rules to save.",
  /** The rules failed the phase's schema (400). The validator's own detail — which
   *  field, which bound — rides beside the code as DATA (`detail`): the composer
   *  needs it, but it is English prose and must never be the thing the UI paints. */
  DECISION_CONFIG_INVALID: "Those rules aren't valid for this phase.",
  /** The rules changed since the client read them (409). Nothing was written: the draft
   *  was built on a plan that is gone, so it is dropped rather than merged. */
  DECISION_CONFIG_STALE: "Someone saved a newer version of these rules. Reload and make your change again.",
  /** POST /api/decisions/screen-wave with no jobId (400). Nothing was ranked. */
  SCREEN_WAVE_JOB_REQUIRED: "Name the role this screening wave should run on.",
  /** GET /api/decisions/role-view with no `job` (400). Nothing was read. */
  ROLE_VIEW_JOB_REQUIRED: "Choose a role to see its candidates side by side.",
  /** POST /api/decisions/shortlist with a malformed body (400). Nothing was written. */
  SHORTLIST_REQUEST_INVALID: "That shortlist change could not be read. Reload and try again.",
  /** The person is not on this role in this workspace (404). Nothing was written. */
  SHORTLIST_ENTRY_UNKNOWN: "That person is no longer on this role. Reload to see the current list.",
  /** Commit without a previewed approval token (409). */
  SCREEN_WAVE_APPROVAL_REQUIRED: "Review the preview and approve this set before committing the wave.",
  /** The approval token is older than SCREEN_WAVE_APPROVAL_MAX_AGE_MS (409). */
  SCREEN_WAVE_APPROVAL_EXPIRED: "This approval has expired. Re-preview and approve the current set before committing.",
  /** The live reject set no longer matches the previewed token (409). */
  SCREEN_WAVE_APPROVAL_MISMATCH: "The candidate set changed since it was previewed. Re-preview and approve the current set before committing.",
  /** The token was already spent on a commit (409). One review authorizes one wave. */
  SCREEN_WAVE_APPROVAL_SPENT: "This review was already used. Re-preview and approve the current set before committing.",
  /** Commit with no named approver (409). Sign in or set KP_OPERATOR_NAME. */
  SCREEN_WAVE_APPROVAL_UNATTRIBUTED: "Sign in or set the operator name so this review can be attributed.",
  /** A role-run gate door named a run that is not this tenant's (404). */
  ROLE_RUN_NOT_FOUND: "That role run could not be found.",
  /** A role-run gate door got no usable gate / branch / decision (400). */
  ROLE_RUN_GATE_INVALID: "Name the gate (rejection, interview invite or offer), the candidate branch and, to commit, your decision.",
  /** The branch is not parked at the named gate (409). Nothing was spent. */
  ROLE_RUN_GATE_NOT_PARKED: "That candidate is not waiting at this gate. Reload the run to see where it stands.",
  /** POST /api/role-runs named no job (400). */
  ROLE_RUN_START_INVALID: "Name the role this run should start for.",
  /** The job to start a run for is not visible to this team (404). */
  ROLE_RUN_JOB_NOT_FOUND: "That role isn't available.",
  /** A pass over this run is already in flight (409); nothing was started. */
  ROLE_RUN_BUSY: "This run is already being advanced. Reload in a moment to see where it stands.",
  /** The board's column axis changed since the composer read it (409) — refused BEFORE
   *  anybody is moved, since the stage ids the mapping names may no longer exist. */
  PIPELINE_AXIS_STALE: "Someone saved a newer version of this pipeline. Reload and make your change again.",
  /** A resend for this outbox row is already in flight in this process (409). The
   *  recovery door spends real email, so a double-click collapses here rather than
   *  dispatching twice — and it now says so with a code, because the button used to
   *  fall through to the generic "couldn't re-send" sentence in all four languages. */
  COMM_RESEND_IN_PROGRESS: "A resend for this message is already in progress.",
  COMM_SIMULATION_ROW: "This message belongs to the guided simulation and is never sent.",
  /** A newer real delivery already exists for this message (409), so re-dispatching
   *  it would send the candidate the same offer/rejection twice. Durable, not
   *  in-process: the check reads the outbox. */
  COMM_ALREADY_RESENT: "Already re-sent. A newer delivery exists for this message.",
  /** The relay config changed since the editor read it (409). Nothing was written: the
   *  POST is a full REPLACE (an absent url disables the relay), so a save built on a
   *  version someone else has since replaced is dropped rather than merged — it used to
   *  win silently and re-point every candidate-facing message. The CURRENT config rides
   *  beside the code as DATA so the card can show what is actually stored. */
  COMMS_RELAY_STALE: "Someone saved a newer relay config. Reload and make your change again.",
  /** The endpoint failed validation (400) — not https, or an internal/loopback host the
   *  SSRF guard refuses. The validator's own sentence names WHICH, and rides beside the
   *  code as `detail`: it is English prose for the log and for API consumers, never the
   *  thing the card paints. */
  COMMS_RELAY_INVALID: "That relay endpoint isn't allowed. Use a public https:// URL.",
  /** An approve arrived for a lifecycle that is not at the review gate (409) — a second
   *  tab, a retried fetch, or a reviewer who left the panel open. The stage rides beside
   *  the code as DATA so the panel can say where the case actually is. */
  DEVCASE_LIFECYCLE_NOT_AT_GATE: "This assignment is no longer awaiting review. Reload to see where it is now.",
  /** A stage move the dev-case lifecycle machine does not allow (409) — e.g. an
   *  advance computed during a minutes-long LLM step arriving after a human closed
   *  the lifecycle. The legal edges live in app/_lib/devcase-transitions.ts, whose
   *  IllegalLifecycleTransition carries this exact spelling as its `code`. */
  DEVCASE_LIFECYCLE_TRANSITION_ILLEGAL: "That step is not possible from this assignment’s current stage.",
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
  BILLING_WEBHOOK_SIGNATURE_INVALID: "The billing event signature could not be verified.",
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
  /** A metered action was refused because the plan's monthly allowance would not
   *  cover it (402) — the app's highest-intent upsell moment, and until now the one
   *  refusal that answered an UNREGISTERED code (`quota_exceeded`) beside a hand-built
   *  English sentence naming the meter. The METER and the PLAN ride beside the code as
   *  data (`{ meter, plan }`) so the reader's own sentence can name them. Produced by
   *  `meterGate` (app/_lib/billing/enforce.ts), whose verdict is shaped exactly like
   *  this helper's body; QUOTA_MESSAGE there is pinned equal to this string.
   *  The corresponding 429 is TASK_BUDGET_EXHAUSTED — see api-contracts.md §1.1 for
   *  why a spent allowance never claims TOO_MANY_REQUESTS. */
  BILLING_QUOTA_EXCEEDED:
    "This action would exceed this month’s allowance on your current plan. Upgrade or top up in Billing.",
  /** The portal was asked for before any completed checkout (404) — a calm
   *  pre-first-purchase state the tab renders as a hint, not an error. */
  BILLING_NO_CUSTOMER: "No billing customer yet. Complete a checkout first.",
  // ---- Public apply door (/perfect 2026-09-03, candidate-apply). Every
  // validation refusal on the two candidate intake surfaces used to be a bare
  // English sentence with no code — which the code-only resolver correctly
  // refused to render, so a Czech applicant whose answer ran two characters over
  // the cap read "something went wrong" and was offered a restart. The caps ride
  // beside the code as DATA (`max`), and so does the STEP the refusal is about
  // (`field`), which is what lets the door re-ask that one question.
  /** The apply link does not resolve to a role (404). */
  APPLY_ROLE_NOT_FOUND: "That role could not be found.",
  /** The submission is over the body cap (413) — an oversized CV extract, usually. */
  APPLY_PAYLOAD_TOO_LARGE: "That application is too large to accept.",
  /** The lead form arrived without a name (400). The conversational door does not
   *  share this: it files a contactless application rather than refusing one. */
  APPLY_NAME_REQUIRED: "That application named no applicant.",
  /** Past the name cap (400). Checked BEFORE the knockout gate, because a decline
   *  persists the label — see the note at that call site. */
  APPLY_NAME_TOO_LONG: "That name is longer than the applicant-name cap.",
  /** One free-text answer is past the per-answer cap (400). `field` names WHICH. */
  APPLY_ANSWER_TOO_LONG: "One of those answers is longer than an answer can be.",
  /** Past the RFC 5321 address length (400). Kept apart from APPLY_EMAIL_INVALID:
   *  "shorten it" and "it isn't an address" are different fixes. */
  APPLY_EMAIL_TOO_LONG: "That email address is longer than an address can be.",
  /** A malformed address (400). A BLANK email is not this: the conversational door
   *  files a contactless application, so only junk is refused. */
  APPLY_EMAIL_INVALID: "That is not a valid email address.",
  /** A self-declared archetype that is not one of the offered options (400) — a
   *  scripted POST, since the UI only renders the script's own choices. */
  APPLY_SELECTION_INVALID: "That is not one of the options offered.",
  /** The role stopped accepting applications (410 Gone) — closed, or back to draft.
   *  Was the ONLY refusal left on either door carrying a body without a code: the
   *  `apply` catalog's own sentence, localized server-side from the request, which
   *  the client cannot render because it resolves what it shows from the CODE. The
   *  page-level gate still renders t("roleClosed"); this is the API's half. */
  APPLY_ROLE_CLOSED: "This role is no longer accepting applications.",
  /** The apply-funnel attempt id or flow failed its shape gate (400) — a scripted
   *  POST, since the client mints both (apply-session-client.ts). Measurement only,
   *  so nothing the candidate did is lost by it. */
  APPLY_SESSION_INVALID: "That application attempt could not be started. Reload the page and try again.",
  /** The profile-gap follow-up's capability token did not resolve (404). ONE code for
   *  "no such token", "token for another job" and "entry has no profile row" — a
   *  public capability route must not let a caller probe which it hit. */
  FOLLOWUP_LINK_NOT_FOUND: "This profile link isn't valid. Your application is safely filed. Ask the recruiter for a fresh one.",
  // ---- The CANDIDATE's own scheduling door (docs/features/scheduling/README.md).
  // Eleven refusals on the public token route were bare English prose with no code —
  // on the one surface whose reader is, by construction, not an operator and may not
  // read English at all. The recruiter half of the same feature was moved onto codes
  // first (SCHEDULE_SLOT_TAKEN and friends above); these are the candidate-facing
  // twins, worded for someone holding a link rather than looking at a grid.
  /** No invite row for this token (404). Either a mistyped/truncated link or one
   *  that was cleaned up — the page tells them to ask for a fresh one. */
  SCHEDULE_LINK_NOT_FOUND: "We couldn't find that scheduling link.",
  /** The link aged out, or the state machine closed it (410 Gone). A stale tab can
   *  still POST after the GET has already rendered the terminal card. */
  SCHEDULE_LINK_CLOSED: "This scheduling link is no longer active.",
  /** The linked pipeline entry went terminal since the link was minted (409) — the
   *  candidate was rejected or withdrew, so nothing on this invite may still move. */
  SCHEDULE_INTERVIEW_UNAVAILABLE: "This interview is no longer available.",
  /** "Propose your own times" was submitted while the picker still has slots (409).
   *  The escalation exists for a genuine dead-end; the remedy is the list. */
  SCHEDULE_SLOTS_STILL_OPEN: "There are still open times. Please pick one from the list.",
  /** The proposed instants failed server-side validation (400): out of hours, in the
   *  past, off the horizon, or more than the three the form offers. */
  SCHEDULE_PROPOSALS_INVALID: "Please suggest 1-3 future weekday times during working hours.",
  /** An RSVP arrived for an invite with no confirmed booking (409) — a stale tab
   *  acting on a card the cancel already replaced. */
  SCHEDULE_NO_BOOKING_YET: "There's no confirmed time to update yet.",
  /** The submitted instant is not one the server would offer (400). The label is
   *  re-authored server-side, so this is the structural gate on body.slotAt. */
  SCHEDULE_SLOT_NOT_OFFERED: "That time isn't one of the offered slots. Please pick from the list.",
  /** Every self-reschedule is spent (409). Not a fault: the remedy is the reply the
   *  message names, and the page also offers the propose-your-own-times escalation. */
  /** A webhook-config save composed against a version another operator has since
   *  replaced (409). Nothing was written: the config is one shared document, and the
   *  remedy is to reload what is stored and re-apply — the panel offers exactly that. */
  ATS_CONFIG_STALE: "Someone saved newer webhook settings. Reload and make your change again.",
  // ---- The Models admin doors (/perfect 2026-09-03, model-keys-need-the-org-key).
  // Provider keys and routing pins were written behind `requireOperator()` alone —
  // "is there a valid session on this deployment?", which every recruiter and viewer
  // satisfies — so re-pointing every model call in the product, or replacing the
  // platform key it runs on, was a capability any seat held. And the keys route
  // answered its four 400s as bare English, which the panel then had to sniff
  // (`error.includes("KP_SECRET")`) to tell the one fixable case apart.
  /** A key or routing write by a signed-in caller who is not an owner (403).
   *  `org:manage` is defined in auth/roles.ts as exactly the owner-only band. */
  MODEL_ADMIN_FORBIDDEN: "Only an owner can change the model keys and routing for this deployment.",
  /** The key request body did not parse (400). */
  MODEL_KEY_BODY_INVALID: "That key request could not be read.",
  /** The named provider is not one this server can store a key for (400). The
   *  accepted list rides beside the code in `providers`. */
  MODEL_KEY_PROVIDER_UNKNOWN: "That isn't a provider this server can store a key for.",
  /** A keyed provider was saved with no API key (400). `provider` carries its id. */
  MODEL_KEY_SECRET_REQUIRED: "This provider needs an API key.",
  /** A KEYLESS provider (a stock local model server authenticates nothing) was saved
   *  with neither a key nor a server URL (400), so the row would say nothing at all. */
  MODEL_KEY_LOCATION_REQUIRED: "Give this provider an API key or a server URL. A row with neither says nothing.",
  /** Azure OpenAI saved without its resource endpoint (400). */
  MODEL_KEY_ENDPOINT_REQUIRED: "Azure OpenAI needs the endpoint of your resource before its key can be stored.",
  /** KP_SECRET is not set on the server (400). Keys are encrypted at rest, so there
   *  is nothing to encrypt with — and storing one in plaintext is refused, never done
   *  quietly. The remedy is an operator's, hence its own code: the panel prints the
   *  env-var fix under it instead of pattern-matching the server's English. */
  MODEL_KEY_ENCRYPTION_UNCONFIGURED: "This server has no encryption secret set, so a provider key can't be stored yet.",
  /** saveProviderKey refused the row (400): an endpoint that is not an Azure OpenAI
   *  resource, a server URL that does not parse, a host that resolves to a private
   *  address. The detail names the host and goes to the server log; the remedy is the
   *  same for the whole class. */
  MODEL_KEY_REJECTED: "That key couldn't be stored. Check the endpoint or server URL you gave.",
  /** A save composed against a row version another admin has since replaced (409).
   *  The sibling of MODEL_ROUTING_STALE, and the stakes are higher: a provider key is
   *  encrypted at rest and unrecoverable, so a last-writer-wins upsert destroyed the
   *  other admin's credential with a green "Saved" on both screens. Nothing was
   *  written; the current rows ride along in `keys` so the panel reloads itself. */
  MODEL_KEY_STALE: "Someone else replaced this key while you were editing it. The stored keys have been reloaded, so make your change again.",
  /** The agent-status pull found no Personas request to poll — the dispatch never
   *  landed. Carried on a 200 beside `refreshed:false`: it is a state, not a failure,
   *  but it is the one state with a remedy (dispatch again), so it needs a code the
   *  roster can say in the reader's language. */
  AGENT_REFRESH_NOT_DISPATCHED: "This agent never reached Personas, so there is no request to poll. Dispatch it again.",
  /** A routing pin composed against a version of the row another operator has since
   *  replaced (409). Nothing was written: the Models table shows the row's own
   *  `updatedAt` and its editor is a long-lived draft, so a last-writer-wins upsert
   *  silently undid the other operator's choice. The current rows ride along in
   *  `rows` so the table reloads itself rather than leaving a stale draft on screen. */
  MODEL_ROUTING_STALE: "Someone re-pinned this use case while you were editing it. The table has been reloaded, so make your change again.",
  SCHEDULE_RESCHEDULE_LIMIT:
    "You've changed your interview time a few times already. Reply to your confirmation email and we'll help you find a slot.",
  /** The guided simulation's argument/lookup refusals (/perfect wave 16,
   *  guided-simulation-1). The demo is PUBLIC (/?sim=auto from the localized
   *  landing CTA), so its visible "Failed: …" line must resolve in the reader's
   *  language rather than paint the route's English prose. */
  SIM_JOB_REQUIRED: "The simulation needs a role to run against.",
  SIM_JOB_NOT_FOUND: "That role no longer exists.",
  SIM_NO_APPLICANT: "No candidate is available to simulate an application from.",
  SIM_ENTRY_REQUIRED: "The simulation needs a pipeline entry to act on.",
  SIM_ENTRY_NOT_FOUND: "That candidate is not on this board.",
  // ---- /api/sim/apply-cv (/perfect wave 22, api-guided-simulation). The last sim
  // door answering English literals, and the one the Channels CV card drives — its
  // `errMsg(data, …)` resolves `code` and otherwise paints a generic sentence, so
  // every one of these shipped English to cs/de/fr readers.
  /** The upload did not arrive as multipart form data (400). */
  SIM_CV_FORM_REQUIRED: "Send the CV as multipart form data.",
  /** No file under the `file` field, or an empty one (400). */
  SIM_CV_FILE_REQUIRED: "Attach a CV file to simulate an application.",
  /** The role no longer accepts applications (410). Was the ad-hoc lowercase code
   *  `role_closed`, which had no `errors.*` entry and so resolved to nothing — the
   *  one refusal a real demo run actually hits. */
  SIM_ROLE_CLOSED: "This role is closed to applications.",
  /** The extractor could not read the attached file. extractUploadedText folds the
   *  client-safe validation, the parsed Python stderr and a raw thrown `.message`
   *  into ONE string, so the detail goes to the server log and the reader gets this.
   *  Returned at the extractor's own status (400/413/500). */
  SIM_CV_UNREADABLE: "That CV could not be read. Try a PDF, DOCX, TXT or MD file.",
  // ---- The public demo door, GET /api/demo (/perfect wave 22). Not a JSON refusal:
  // the door is a plain navigation from the landing CTA, so it redirects to
  // `/?demo=unavailable&code=<CODE>` and DemoUnavailableNotice resolves the code in
  // the reader's language — the same `errors.<CODE>` vocabulary, one renderer.
  /** The demo is switched on but cannot be delivered: a demo-workspace session
   *  carries EMPTY_CAPS (current-user.ts) so the walk 401s on its first write, and
   *  nothing seeds the demo tenant. Nothing the operator can flip today. */
  DEMO_NOT_PROVISIONED: "The live demo is not set up on this deployment yet.",
  /** KP_DEMO_ENABLED is off on a gated deploy (workspace-lock.ts) — the operator
   *  CAN turn this one on. */
  DEMO_DISABLED: "The live demo is turned off on this deployment.",
  /** POST /api/sim/reset while another guided run holds this workspace (409).
   *  Every demo visitor and every operator tab shares ONE tenant and a run STARTS by
   *  deleting every SIM row in it, so a second start used to wipe the first walk's
   *  job mid-tour. `retryAfterSeconds` rides beside the code as data — the holder's
   *  remaining lease (sim-store.ts SIM_RUN_TTL_MS), not a guess. */
  SIM_RUN_ACTIVE: "A guided demo is already running here. Wait for it to finish, or stop it first.",
  /** A release or renew of the run lock that did NOT come from the tab holding it
   *  (409, /perfect wave 44). The wave-22 lease had no owner, so a second tab
   *  refused with SIM_RUN_ACTIVE still ran its own end-of-run DELETE, freed the
   *  holder's lease, and one more press wiped a live run. 409 rather than 403: the
   *  lock is a courtesy between racing tabs, never an authorization boundary, and
   *  the caller is out of date about the tenant rather than forbidden. Carries the
   *  holder's remaining lease as `retryAfterSeconds`, exactly like SIM_RUN_ACTIVE. */
  SIM_RUN_NOT_OWNER: "That guided demo belongs to another tab. Wait for it to finish, or stop it there.",
  /** GET /api/feedback is a read of colleagues' free-text reports WITH their reply
   *  addresses, so it is `members:manage`-gated (/perfect wave 17, api-workspace).
   *  One code covers both statuses requireCapability produces — 401 with no session,
   *  403 for a member who lacks the capability — because the remedy is identical and
   *  the control room renders the same sentence either way. */
  FEEDBACK_READ_FORBIDDEN: "Only someone who can manage members may read the feedback inbox.",
  /** The recruiter feedback door's two validator refusals (/perfect wave 17,
   *  shell-nav). parseFeedbackSubmission used to put its own English sentence in
   *  the 400 body and the limiter answered 429 with no code at all, so the dialog
   *  showed its generic "could not send" to a throttled sender in every locale. */
  FEEDBACK_MESSAGE_REQUIRED: "Write a message before sending.",
  /** Keep the number in step with FEEDBACK_MESSAGE_MAX (app/_lib/feedback.ts). */
  FEEDBACK_MESSAGE_TOO_LONG: "That message is too long. Please shorten it to 2,000 characters or fewer.",
  // ---- Background-task doors (/perfect wave 17, background-tasks). POST
  // /api/tasks and POST /api/tasks/[id]/retry answered every refusal with a bare
  // English sentence and no code, so the dock's start-error banner painted the
  // server's string at a Czech or French recruiter.
  /** A kind this build has no handler for (400) — a hand-rolled call, or a row
   *  written by an older version whose kind has since been dropped. */
  TASK_KIND_UNKNOWN: "This kind of AI task does not exist in this version.",
  /** A task kind whose params are server-built (file paths in a fresh workdir) was
   *  asked for through the generic POST /api/tasks door (403). It has its own route. */
  TASK_KIND_SERVER_ONLY: "This kind of AI task can only be started from its own screen.",
  /** The per-kind budget class refused this start (429). Distinct from
   *  TOO_MANY_REQUESTS, which is the door's overall burst bucket: this one says
   *  "too many runs of THIS weight", and the remedy is to wait rather than to slow
   *  down. The class rides along in `budgetClass`. See app/_lib/task-budget.ts. */
  TASK_BUDGET_EXHAUSTED: "Too many AI runs of this kind have been started recently. Try again shortly.",
  /** A task id that resolves to nothing, or to another team's row (404). The two
   *  stay DELIBERATELY lumped: a distinct refusal would confirm which task ids
   *  exist on other tenants. */
  TASK_NOT_FOUND: "That task no longer exists.",
  /** A replay asked for on a row that is still queued, running, or already
   *  succeeded (409). The status is re-read server-side, so a dock left open across
   *  a state change refuses instead of duplicating a live run. */
  TASK_NOT_RETRYABLE: "Only failed, interrupted or canceled tasks can be re-run.",
  /** A replay whose uploaded inputs were cleaned up when the original run exited
   *  (409). Not a fault: runAnalyze deletes its workdir in a `finally`, so the
   *  honest answer is "upload them again" rather than a second red row. */
  TASK_REPLAY_INPUTS_GONE: "The uploaded files for this run have been cleaned up. Upload them again to re-run it.",
  // ---- Authorization (/perfect wave 18, write-routes-check-a-capability). The
  // write doors gate on requireOperator, which answers "is a trusted session
  // present?" — never "may THIS seat do this?". A viewer could seal an adverse
  // decision, move the thresholds it is judged against or rewrite relay
  // credentials. The doors now ask the capability, and a refusal must be a CODE:
  // "Forbidden" is a word, not something a Czech recruiter can act on.
  /** The caller is authenticated but their seat lacks the capability the door
   *  requires (403). The capability itself rides beside the code as `capability`
   *  so the UI can name what is missing ("this needs pipeline:write") and the
   *  operator knows which permission to ask for — the message alone cannot say it
   *  without hard-coding one sentence per capability. Unauthenticated stays 401
   *  with the bare Unauthorized envelope: a caller with no session has nothing to
   *  be told about capabilities. */
  FORBIDDEN_CAPABILITY: "Your role does not allow this action.",
  // ---- JD templates (/perfect wave 19, template-manager-fails-loudly). Every one
  // of these was English prose forwarded straight from the store's `reason` (or a
  // bare "Template not found."), so the manager painted an English sentence into a
  // Czech session and had no code to key on.
  /** The id resolves to nothing this team can see — gone, or another team's private
   *  draft (404). Deliberately lumped: distinguishing them would confirm which
   *  template ids exist on other tenants. */
  TEMPLATE_NOT_FOUND: "That template no longer exists.",
  /** An unsupported {{token}} in a template body (400); `tokens` lists the rejected names. */
  TEMPLATE_UNKNOWN_PLACEHOLDERS: "This template contains unsupported placeholders.",
  /** The only template this team can still see (400). Deleting it would leave the
   *  JD builder's picker empty, and the org seed only re-runs on an empty tier. */
  TEMPLATE_LAST_ONE: "This is the last template your team can see. Keep at least one.",
  /** The org default (400). Promote another template first; a library with zero
   *  defaults has no baseline to build from. */
  TEMPLATE_IS_DEFAULT: "This is the default template. Set another template as the default before deleting it.",
  /** The edit's base `updatedAt` no longer matches the row (409). The winning row
   *  rides beside the code as `template` so the manager can reload it in place
   *  instead of re-fetching a list to find out what happened. */
  TEMPLATE_STALE: "Someone else saved this template while you were editing. Reload it and reapply your changes.",
  /** Promote-to-default aimed at a team-private draft (400). The default is an
   *  ORG-wide baseline, so only a shared template can hold it. */
  TEMPLATE_DEFAULT_ORG_ONLY: "Only a template shared with the whole company can be the default.",
  // ---- The dev-case control room (/perfect wave 21, internal-explorers). All three
  // were bare English 400s: the room POSTed and never read the body, so a refusal
  // rendered as success, and once it DID read it there was nothing to key on.
  /** POST /api/devcase/control with an action outside pause/resume/reconcile (400) -
   *  a hand-rolled call or a stale tab. The action rides beside the code as data. */
  DEVCASE_CONTROL_ACTION_UNKNOWN: "That control-room action is not one this deployment knows.",
  /** A promote floor that is not a finite number (400). typeof NaN is "number", so the
   *  store would take it, read it back as null and quietly revert to the default while
   *  the audit trail claimed a calibration that never took effect. */
  DEVCASE_FLOOR_INVALID: "The promote floor must be a number between 0 and 100.",
  /** A recorded outcome that fails the canonical vocabulary / 1-5 hired-only scale
   *  (400). The zod sentence rides beside the code as `issue` for the log and for API
   *  consumers; the reader gets this one in their own language. */
  DEVCASE_OUTCOME_INVALID: "That outcome could not be recorded: check the result and the performance score.",
  // ---- The three PUBLIC dev-case candidate doors (/perfect wave 23,
  // devcase-candidate-and-devcase). Session-start, the live finalize and the
  // inbound webhook each still answered a handful of bare English sentences with
  // no code — on a surface the app renders in en/cs/de/fr for someone who is not
  // logged in and has no way to ask what it meant.
  /** The apply link was absent or empty on a door that needs it (400/401). One
   *  refusal for "missing" and "not a token we know", deliberately: the mint's
   *  DEVCASE_SESSION_UNAVAILABLE note explains why these doors must not be an
   *  oracle for guessing apply tokens. */
  DEVCASE_APPLY_TOKEN_REQUIRED: "This apply link isn't valid. Ask the recruiter for a fresh one.",
  /** The finalize door was handed a session id that resolves to nothing, or to a
   *  row with no posting behind it (404). Lumped on purpose: both mean "this
   *  attempt cannot be sealed, start again from your link", and telling them apart
   *  would confirm which session ids exist. */
  DEVCASE_SESSION_NOT_FOUND: "This work session can't be found. Open your apply link again to start a new one.",
  /** An application arrived without a name or without a solution reference (400).
   *  The public form validates both client-side, so this is a hand-rolled or
   *  external-channel call — which is exactly the caller who needs a code. */
  DEVCASE_SUBMISSION_FIELDS_REQUIRED: "A name and a link to your solution are both required.",
  DEVCASE_CONTACT_REQUIRED: "Enter an email address so we can confirm your submission.",
  // ---- The four studio doors (/perfect wave 31, api-devcase-2). The manual approve
  // and the credential mint answered bare English for every refusal, on doors whose
  // consumers (useDevTabActions.runAction, DevSubmissionRowSkillProfile) resolve
  // errors.<CODE> in the reader's language and show a neutral generic without one.
  /** POST /api/devcase without both halves of the design (400). Approving persists a
   *  role AND a case; either alone is not a case anyone can be sent. */
  DEVCASE_CASE_FIELDS_REQUIRED: "A role and a case are both required to approve.",
  /** POST /api/devcase/skill-profile with no submission reference (400). */
  DEVCASE_SUBMISSION_ID_REQUIRED: "A submission reference is required.",
  /** The mint was handed a submission id that resolves to nothing, or to another
   *  team's row (404). ONE refusal for both on purpose: telling them apart would
   *  confirm which submission ids exist outside the caller's team. */
  DEVCASE_SUBMISSION_NOT_FOUND: "That submission can’t be found.",
  /** The submission exists and is the caller's, but carries no evaluation yet (409) -
   *  a credential is EARNED, so there is nothing to sign. Distinct from the 404 because
   *  the remedy is different: evaluate it, then mint. */
  DEVCASE_SUBMISSION_NOT_EVALUATED: "Only an evaluated submission can mint a Durable Skill Profile.",
  // ---- Inbound channel receivers (/perfect wave 27, api-comms). The Channels-tab
  // receiver doors answered bare English prose for every refusal, and they are now
  // capability-gated and throttled, so the modal and the receiver list have two more
  // refusals to paint on top of those.
  /** The requested channel is not one kp can receive on (400). Carries the rejected
   *  value as data, never in the message. */
  CHANNEL_UNKNOWN: "That channel isn't one kp can receive on.",
  /** The role a receiver would bind to is not visible to the caller's team (404).
   *  Deliberately the same answer as "no such role": a caller must not be able to
   *  discover another team's confidential openings by id. */
  CHANNEL_JOB_NOT_FOUND: "That role isn't available.",
  /** A receiver token was required and absent (400). */
  CHANNEL_TOKEN_REQUIRED: "A receiver token is required.",
  /** The token names no receiver in the caller's team (404) — the same answer the
   *  public receiver gives, so this door is not a probe for which tokens exist. */
  CHANNEL_WEBHOOK_NOT_FOUND: "That receiver can't be found.",
  /** The pull URL failed the stored-URL validator (400). The validator's own English
   *  sentence — which host, which field — rides beside the code as `detail` data. */
  CHANNEL_PULL_URL_INVALID: "That pull URL isn't allowed.",
  /** An intake dialog or voice turn overran its per-thread budget in
   *  app/_lib/intake-run.ts and was stopped (504). A DECISION, not a store fault:
   *  the spawn used to inherit python-runner's ten-minute hang backstop, so a stalled
   *  provider held the requestor on a spinner for nine minutes past the point the
   *  answer was useful. Named so the composer can offer a retry. */
  INTAKE_TURN_TIMEOUT: "That turn took too long and was stopped. Send it again.",
  /** The profile router (pipeline.jobfit.profile_cli) overran PROFILE_ROUTE_TIMEOUT_MS
   *  in app/api/profile/route.ts and was stopped (504). A DECISION, not a store fault:
   *  the spawn used to inherit python-runner’s ten-minute hang backstop, so a wedged
   *  child held the editor’s Save open for nine minutes past the point the answer was
   *  useful — with the recruiter’s unsaved intake still in the form. Named so the editor
   *  can offer a retry instead of painting a generic failure over live text. */
  PROFILE_BUILD_TIMEOUT: "Routing that profile took too long and was stopped. Try saving again.",
  /** The winnability coach (pipeline.jobfit.winnability_cli) overran
   *  WINNABILITY_TIMEOUT_MS in app/api/jobs/[id]/winnability/route.ts and was stopped
   *  (504). Deterministic sub-second scoring, so an overrun means the child wedged —
   *  the honest answer is “we stopped waiting, try again”, which the coach panel’s
   *  existing retry affordance already offers. */
  JOB_WINNABILITY_TIMEOUT: "Grading this role took too long and was stopped. Try again.",
  /** The number of hires a role is opened for was outside 1..50 (POST
   *  /api/jobs/[id]/publish). A DECISION about the caller's own input, not a fault:
   *  the wizard's own number field already holds the range, so this door is what
   *  makes the range true for anything that is not the wizard. */
  JOB_TARGET_HIRES_INVALID: "A role is opened for between 1 and 50 hires.",
  /** The requested posting language is not one of the app's locales, or it is the
   *  language the posting is already written in (POST
   *  /api/jobs/[id]/translations). A DECISION: there is nothing to translate. */
  JOB_TRANSLATION_LANG_INVALID: "That is not a language this posting can be translated into.",
  /** No AI model answered, so the posting was NOT translated and nothing was stored
   *  (pipeline.jobfit.posting_translate_cli refused). A DECISION, and the one place
   *  in the app where keyless means "no output" rather than "a deterministic
   *  output": a translation has no deterministic twin, and a stub posting presented
   *  as a German advertisement would be worse than none — it is the document a
   *  candidate applies against. The empty state stays and offers the retry. */
  JOB_TRANSLATION_UNAVAILABLE: "No AI model is configured, so this posting was not translated.",
  /** GET /api/jobs/[id] and the ingest / candidates / outreach by-id doors: no such
   *  job, or another team's. 404, never 403, so the id is not an existence oracle. */
  JOB_NOT_FOUND: "That role isn't in your catalog.",
  /** POST /api/jobs/ingest with a paste shorter than MIN_AD_CHARS. The panel already
   *  guards this; the door makes the floor true for anything that is not the panel. */
  JOB_AD_TOO_SHORT: "Paste the full job ad. A short snippet is not enough.",
  /** POST /api/jobs/[id]/candidates/outreach with no candidateId (400). */
  OUTREACH_CANDIDATE_REQUIRED: "Name the candidate to reach out to.",
  /** The comms channel refused a send because the candidate may not be contacted —
   *  they were ANONYMIZED, their processing consent EXPIRED, or (for an outreach
   *  message only) the sequence was stopped. A DECISION, not a fault: `sendComm`
   *  re-asserts the gate that used to live in `dispatchOutreach` alone, so the resend
   *  door and the dev-case doors can no longer skip it (comms.ts
   *  `commsSendSuppression` / `CommsSuppressedError`). The recruiter's next step is to
   *  stop trying, not to retry, so the sentence says so. */
  COMMS_SUPPRESSED: "This candidate can no longer be contacted.",
  /** An outreach letter over the length cap after cleaning (422): deterministic, so retrying the same text cannot succeed. The candidate CAN be contacted; this letter cannot be sent. */
  OUTREACH_BODY_TOO_LONG: "This letter is too long to send. Shorten it and try again.",
  /** The voice engines answered `unavailable` (503): no TTS / STT provider is configured on
   *  this server. A DECISION about the install, not a fault - the generic TTS_FAILED /
   *  STT_FAILED sentence told a keyless operator to "try again", which cannot help. */
  TTS_UNAVAILABLE: "Voice is not configured on this server, so nothing can speak.",
  STT_UNAVAILABLE: "Transcription is not configured on this server.",
  /** The TTS engine refused the VOICE, not the request (400, /api/tts). Split off
   *  TTS_FAILED 2026-09-05: "pick another voice" and "try again" read identically
   *  when both answer the same code, and a caller told to retry retries the same
   *  unusable voice id forever. */
  TTS_VOICE_INVALID: "That voice cannot be used for this. Pick another voice.",
  /** The utterance is longer than the package's own 1200-char ceiling (400,
   *  /api/tts). Refused BEFORE the body is hashed into a cache key, and it rides
   *  with `maxChars` so the reader's own sentence can carry the number. */
  TTS_TEXT_TOO_LONG: "That text is too long to speak in one go. Send it in shorter pieces.",
  /** Companion proposal doors (WP3), moved here 2026-09-05 from STORE_ERRORS: both
   *  are DECISIONS, not accidents. "That proposal is gone" (404) and "someone already
   *  answered it" (409) are different facts, and the second is the ordinary outcome
   *  of two open docks. The 409 carries the current row beside the code so the card
   *  can repaint as answered (app/api/companion/proposals/[id]/resolve/route.ts). */
  COMPANION_PROPOSAL_NOT_FOUND: "That proposal is no longer available.",
  COMPANION_PROPOSAL_RESOLVED: "That proposal was already answered.",
  /** The per-candidate ATS export refused because the entry was ANONYMIZED (410).
   *  A DECISION, not "not found": the operator can still see the masked row on the
   *  board, so a 404 would deny an erasure the product performed on purpose.
   *  `buildAtsRecord` (ats-record.ts) refuses through the shared consent predicates;
   *  the route surfaces that refusal under its own code instead of the 404 the
   *  missing-entry branch answers. */
  ATS_CANDIDATE_ERASED: "This candidate's data was erased and cannot be exported.",
  /** The per-candidate ATS export found no entry for this caller (404). Deliberately
   *  ONE code for "never existed" and "belongs to another team": the two are
   *  indistinguishable to a caller who does not hold the entry, which is the tenancy
   *  property the route's own comment records. Distinct from ATS_CANDIDATE_ERASED,
   *  which is a decision about an entry that IS there. */
  ATS_CANDIDATE_NOT_FOUND: "That candidate is not on this board.",
  // ---- Inbound ATS connection refusals (/perfect wave 41, api-ats-integration).
  // The connections door answered five hand-written English sentences and forwarded
  // every message the field-map parser and the connection store threw, straight into a
  // panel that renders through useErrorMessage in four languages. The store and the
  // parser now carry a code on the thrown error and the route maps it; the sentences
  // below are what the operator actually reads, so each one names the fix.
  /** `provider` is not on ATS_PROVIDERS (or the DELETE arrived without one). */
  ATS_CONNECTION_PROVIDER_UNKNOWN: "That is not an ATS Kandi can connect to. Pick a provider from the list.",
  /** The base URL failed the SSRF boundary (https-only, public host, no IP literal). */
  ATS_CONNECTION_BASE_URL_INVALID: "The API base URL must be an https:// address on a public host.",
  /** The token was not text, or could not be encrypted because no at-rest key is set. */
  ATS_CONNECTION_TOKEN_INVALID: "That API token could not be stored. Check the server has an encryption key configured.",
  /** parseFieldMap refused the map — an unknown field, an empty path, or no externalId,
   *  which is the sync identity and the one path a map cannot go without. */
  ATS_FIELD_MAP_INVALID: "That field map is not usable. Every mapped field needs a path, and the external id path is required.",
  /** DELETE named a provider with no stored connection (404). */
  ATS_CONNECTION_NOT_FOUND: "There is no connection stored for that ATS.",
  /** The write was composed against a connection someone else has since replaced (409).
   *  Same doctrine as ATS_CONFIG_STALE next door: nothing was written, and the panel's
   *  answer is to reload and re-apply rather than to retry blind. */
  ATS_CONNECTION_STALE: "Someone saved a newer version of this ATS connection. Reload and make your change again.",
  /** POST /api/ats/deliveries { replayId } named a ledger row that is not there (404). */
  ATS_DELIVERY_NOT_FOUND: "That delivery is not in the ledger.",
  /** POST /api/ats/deliveries { replayId } named a row that is not a dead-letter (409).
   *  Delivered, pending, and still-due failures stay on their own path; only a failed
   *  row with no next attempt can be force-retried. */
  ATS_DELIVERY_NOT_REPLAYABLE: "That delivery cannot be replayed. Only a dead-lettered failure can be force-retried.",
  // ---- Interview-prep refusals (/perfect wave 37, lib-voice-interview-11).
  // The five write verbs of /api/interview-prep answered bare English sentences with
  // no code, while their voice twins next door had been coded since 2026-09-02. The
  // human scorecard form renders through useErrorMessage, so every one of them painted
  // the server's English at whatever language the recruiter reads the app in.
  /** The pack this verb would read, merge into or attach a scorecard to does not
   *  exist for this caller (404). Deliberately ONE code for "never generated" and
   *  "belongs to another team": the two are indistinguishable to a caller who does not
   *  hold the entry, which is the tenancy property the routes' own comments record. */
  INTERVIEW_PREP_NOT_FOUND: "There is no interview prep pack for this candidate yet. Generate it first.",
  /** An import arrived with nothing importable in it (400) — an empty list, or one
   *  whose every item normalized away. */
  INTERVIEW_PREP_QUESTIONS_REQUIRED: "Pick at least one question to add to the prep pack.",
  /** A weave/unassign arrived without naming the question to move (400). */
  INTERVIEW_PREP_QUESTION_REQUIRED: "Say which question to move.",
  /** A recruiter's per-candidate overlay on the job interview kit could not be stored
   *  (400): not an overlay at all, an entry the reader would have to discard, or a cap
   *  the prep modal shows before saving (too many additions, drops or rewrites, too many
   *  must-asks, an empty or over-long question). ONE refusal; which rule tripped rides
   *  beside it as `reason` data (interview-prep-kit.ts parseKitOverlayWrite). */
  INTERVIEW_PREP_OVERLAY_INVALID: "These changes to the candidate's interview questions could not be saved.",
  /** A kit arrived that cannot be stored as one (400): no competency, a competency with
   *  no question, a weight outside the three steps, or a budget that is not a positive
   *  number of minutes. Deliberately ONE refusal for all of them — the recruiter's next
   *  step is the same (fix the field the editor is pointing at), and WHICH rule tripped
   *  rides beside the code as `reason`/`at` data rather than as a second English
   *  sentence. Caps are NOT in this list: they are repaired by trimming, not refused
   *  (app/_lib/interview-kit-validate.ts states that line). */
  INTERVIEW_KIT_INVALID: "This interview kit is not complete enough to save yet.",
  /** A publish (or a by-version read) named a kit version this team does not have, or one
   *  that is already published (404). The two are ONE refusal on purpose: a version id is
   *  handed to every recruiter on the team, so distinguishing them would turn the door
   *  into an existence oracle for another team's ids without telling this one anything
   *  they cannot see by reloading. */
  INTERVIEW_KIT_NOT_FOUND: "That version of the interview kit is not available.",
  // ---- Engine admission (app/_lib/python-runner.ts). Every request that needed the
  // Python pipeline used to fork its own interpreter with nothing counting them, so a
  // burst was a burst of ~150 MB processes and the box — not the request — paid.
  /** The spawn ceiling (KP_PYTHON_MAX_CONCURRENT) was full and the caller waited out its
   *  queue budget (503). A DECISION, not a fault: the engine is healthy, it is simply
   *  saturated, and the honest answer is "in a moment" rather than a 500 or a socket held
   *  open past the client's own deadline. python-runner.ts carries this sentence as a
   *  literal (it must not pull next/server in through this module) — keep the two equal. */
  ENGINE_BUSY: "The analysis engine is busy right now. Try again in a moment.",
  /** The CV analysis overran ANALYZE_TIMEOUT_MS (app/_lib/analyze-run.ts) and its child
   *  was killed (504). A DECISION, not a store fault: the spawn used to inherit
   *  python-runner's ten-minute hang backstop, which — now that spawns run under the
   *  admission semaphore above — meant one wedged run held a quarter of the engine's
   *  concurrency for ten minutes and pushed everyone else to ENGINE_BUSY. analyze-run.ts
   *  carries this sentence as a literal (it runs inside the task runner and must not pull
   *  next/server in through this module) — keep the two equal; analyze-run.test.ts fails
   *  if they drift. The advice names the one lever the recruiter actually has, since a
   *  multi-CV comparison spawns a child per variant against the same ceiling. */
  ANALYZE_TIMEOUT: "The analysis took too long and was stopped. Try again, or with fewer CVs at once.",
  // ---- Organization backup / restore (app/_lib/db-portability.ts + the two
  // /api/workspace routes). The engine refused in English prose and the routes
  // forwarded it: "Refusing to load — these tables already contain rows: …" was what a
  // Czech administrator read while deciding whether to overwrite their whole company.
  /** The uploaded body is larger than the import route accepts (413). Named rather than
   *  generic: the operator's next move is to check they picked the backup file and not
   *  something else, which a bare "payload too large" does not suggest. */
  IMPORT_BODY_TOO_LARGE: "That file is larger than a workspace backup can be. Check you picked the right file.",
  /** The request carried no `dump` field at all (400). */
  IMPORT_DUMP_REQUIRED: "Send the JSON content of a kp-org-dump backup file.",
  /** The dump failed structural validation (400) — wrong format/version, a malformed
   *  table, an identifier that is not a plain identifier. `detail` rides alongside for
   *  the operator's console; the surface renders this sentence. */
  IMPORT_DUMP_MALFORMED: "That file is not a valid kp-org-dump backup.",
  /** There is no database file to read yet (503). Reachable on a deployment whose
   *  volume was mounted empty — a state to fix, not a fault in the request. */
  PORTABILITY_NO_DATABASE: "There is no workspace database yet. Start the app, then try again.",
  /** The whole-database load found tables that already hold rows and no explicit
   *  replace authorization (409). */
  PORTABILITY_TABLES_POPULATED: "Some tables already contain rows. Confirm the replace before loading this file.",
  /** A workspace or account id the backup claims is now owned by a DIFFERENT
   *  organization (409). Refused rather than skipped: skipping would leave the delete
   *  out and still insert the file's rows, injecting them into a bystander's tenant. */
  RESTORE_SCOPE_TAKEN: "Something in this backup now belongs to another organization, so it cannot be restored.",
  /** A table or column name in the file is not a plain identifier (400). The file's DDL
   *  is executed by design, so a crafted name is refused rather than quoted and hoped
   *  for. */
  RESTORE_UNSAFE_IDENTIFIER: "This backup file contains an unsafe table or column name and was refused.",
  // ---- Request-body budget (app/_lib/request-body.ts). Every PUBLIC route reads
  // its body under a hard byte cap enforced on the bytes READ, not on the caller's
  // content-length; see docs/architecture/api-contracts.md §1.5c.
  /** The request body exceeded the route's declared cap (413). Generic on purpose:
   *  it is the answer on doors where the caller is a machine or a form with nothing
   *  more useful to say. Surfaces with a specific next move keep their own code —
   *  APPLY_PAYLOAD_TOO_LARGE ("shorten your answers"), IMPORT_BODY_TOO_LARGE ("check
   *  you picked the right file"). `maxBytes` rides alongside as data. */
  PAYLOAD_TOO_LARGE: "That request was too large to accept. Send less at once.",
  // ---- White-label brand (/perfect wave 38, brand-theming). PUT /api/brand used to
  // answer 200 with a bad accent or logo QUIETLY REPLACED BY NULL, so the operator was
  // told their brand had been applied when it had not. Each reason is its own code
  // because each has a different fix, and a legibility failure NAMES ITS THEME:
  // Studio Light and Spark Dark ask for opposite corrections.
  /** The accent is not a hex color (400) — including the CSS-injection shapes the
   *  store has always refused, which reach a server-rendered <style>. */
  BRAND_ACCENT_INVALID: "That accent is not a color. Use a hex value in the form #RRGGBB.",
  /** A valid hex that cannot be read in STUDIO LIGHT (400): below 3:1 against the
   *  button label sitting on it or against the cream canvas its focus ring is drawn
   *  on (WCAG 1.4.3 / 2.4.7). */
  BRAND_ACCENT_ILLEGIBLE_LIGHT: "That accent is too light for Studio Light: button text and focus rings would be invisible. Pick a darker color (at least 3:1).",
  /** A valid hex, legible in Studio Light, with no SPARK DARK twin (400). The dark
   *  accent is derived by lifting lightness at a fixed hue, and the lift is capped so
   *  the twin stays the operator's brand — a near-black accent has no legible twin
   *  that is still near-black. "Darker" is exactly the wrong advice here, which is
   *  why this is not the same code as the light failure. */
  BRAND_ACCENT_ILLEGIBLE_DARK: "That accent has no readable Spark Dark version. It is too dark to lift without becoming a different color, so pick a brighter or more saturated one.",
  // ---- The saved-analysis doors (/perfect wave 39, lib-analyze).
  /** No analysis with this slug in the caller's workspace (404). ONE code for "never
   *  existed" and "belongs to another team": the two are indistinguishable to a caller
   *  who does not hold the row, which is the tenancy property the read enforces. */
  ANALYSIS_NOT_FOUND: "That analysis is not in this workspace.",
  // ---- Cohort Studio (Analyze v2, /api/analyze/cohort*).
  /** No cohort with this id in the caller's workspace (404) — one code for "never
   *  existed" and "another team's", like ANALYSIS_NOT_FOUND. */
  COHORT_NOT_FOUND: "That comparison is not in this workspace.",
  /** The start body is malformed: a missing JD, a membership outside the vocabulary, a
   *  repeated member, or a size outside [min, max] — both ride as data (400). */
  COHORT_REQUEST_INVALID: "That comparison cannot start. Choose between 2 and 20 candidates for one role, then try again.",
  /** A chosen member does not resolve to a readable CV in this workspace — gone, erased,
   *  consent expired, or another team's (400). `memberId` rides as data. */
  COHORT_MEMBER_NOT_FOUND: "One of the chosen candidates has no readable CV in this workspace any more.",
  /** The attached GitHub deep-dive failed githubAnalysisSchema (400). The client that
   *  posts it built it itself, so this is a bug report, not recruiter advice. */
  ANALYSIS_GITHUB_INVALID: "That GitHub analysis could not be read and was not attached.",
  /** The attached deep-dive is past MAX_GITHUB_JSON_BYTES (413). A real dossier is tens
   *  of KB; anything near the ceiling is malformed rather than thorough. */
  ANALYSIS_GITHUB_TOO_LARGE: "That GitHub analysis is too large to attach.",
  /** The logo URL is not an `https://` link, or is past the storable length (400).
   *  Both used to store as null behind a green "Saved": a truncated signed CDN URL is
   *  still a valid https URL, so it round-tripped happily and 403'd forever. */
  BRAND_LOGO_INVALID: "That logo link must be an https:// URL, short enough to store.",
  /** The uploaded logo file is empty (400). */
  BRAND_LOGO_EMPTY: "That logo file is empty.",
  /** The uploaded logo is past the byte cap, measured on the bytes read (413). The cap
   *  rides along as `maxBytes`. */
  BRAND_LOGO_TOO_LARGE: "That logo file is too large.",
  /** The upload is neither a PNG (by magic bytes) nor an SVG (400). */
  BRAND_LOGO_TYPE: "A logo must be a PNG or SVG file.",
  /** An SVG that carries script, a foreign HTML island, event handlers, an external
   *  reference, or markup the strict reader cannot account for (400). */
  BRAND_LOGO_UNSAFE: "That SVG contains something a logo may not (script, external links or embedded content).",
  // ---- The public text-extraction door (/perfect wave 41, db-profiles). POST
  // /api/extract-text spawns pipeline.jobfit.extract_cli per request and is reachable
  // with no session, yet it answered every failure with the ENGINE's own prose —
  // parseStderrError's message on a non-zero exit, the thrown `.message` on the
  // catch-all. It had the code all along and dropped it.
  /** The POST carried no file (400). The apply form and the analyze form both send
   *  one, so reaching this is a hand-rolled call or a dropped multipart part. */
  EXTRACT_FILE_REQUIRED: "Attach a file to read text from.",
  /** The extractor refused the document (400): a scanned PDF with no text layer, an
   *  encrypted DOCX, a renamed binary. ONE code for all of them — the reader's next
   *  move is the same, and which one it was is operator detail for the log. */
  EXTRACT_TEXT_UNREADABLE: "That file could not be read. Try a PDF, DOCX, TXT or MD file with selectable text.",
  /** The extractor overran EXTRACT_TIMEOUT_MS (504) — 5s inside the route's own
   *  maxDuration budget, so cleanup still runs. A decision, not a fault. */
  EXTRACT_TEXT_TIMEOUT: "Reading that file took too long and was stopped. Try a smaller file.",
  // ---- The chat and flush doors of a work session (/perfect wave 42a,
  // devcase-identity-and-lifecycle). Both answered bare English sentences with no
  // code, on the surface a candidate spends an hour inside.
  /** The session has been finalized, so it takes no more work (409). Distinct from
   *  DEVCASE_SESSION_NOT_FOUND on purpose: nothing is lost and nothing is broken,
   *  the attempt is simply over, and a second tab is the usual way to reach it. */
  DEVCASE_SESSION_ALREADY_SUBMITTED: "This work session has already been submitted.",
  /** A chat turn arrived empty, or as something that is not text (400). */
  DEVCASE_CHAT_MESSAGE_REQUIRED: "Write a message before sending it.",
  // --- Job-seeker module (/me) ---------------------------------------------------
  /** No seeker profile exists yet for this workspace/user (404): upload a CV first. */
  JOBSEEKER_PROFILE_MISSING: "Start with your CV: there is no job-search profile yet.",
  /** A tier-B board was enabled without the owner's acknowledgement (409). The card
   *  states the robots posture and the terms clause; enabling is a decision, not a click. */
  JOBSEEKER_SOURCE_NOT_ACKNOWLEDGED: "Read this source's terms and confirm you accept the exposure before enabling it.",
  /** A tier-C source (blocks or forbids automated access) can never be enabled (403). */
  JOBSEEKER_SOURCE_REFUSED: "This source blocks or forbids automated access, so it cannot be enabled.",
  /** The source answered a denial (403/429/interstitial) and was paused (423). Only the
   *  owner resumes it — a block is a relationship signal, never something to retry. */
  JOBSEEKER_SOURCE_BLOCKED: "This source declined our requests and was paused. Resume it only if you understand why.",
  /** Every required extraction rule missed on a page that fetched fine: the page shape
   *  changed (502). Zero rows is not success here. */
  JOBSEEKER_SOURCE_COLLAPSED: "The page layout changed and nothing could be read. Re-check the extraction rules.",
  /** The submitted rule set fails the DSL's validation (400). */
  JOBSEEKER_RULES_INVALID: "These extraction rules are not valid.",
  /** The dry-run preview could not fetch or run against the live page (502). */
  JOBSEEKER_PREVIEW_FAILED: "Could not preview the rules against the live page.",
  /** The source id in the URL (or the catalog id in the body) is not one this
   *  workspace knows (404). */
  JOBSEEKER_SOURCE_NOT_FOUND: "That job source does not exist.",
  /** The dialog in the URL does not exist in this workspace (404). */
  JOBSEEKER_DIALOG_NOT_FOUND: "That conversation does not exist.",
  /** The dialog is closed; reopen or start a new one (409). */
  JOBSEEKER_DIALOG_CLOSED: "This conversation is closed.",
  /** The dialog changed while the turn was computed; the turn was dropped, not merged (409). */
  JOBSEEKER_DIALOG_MOVED: "The conversation changed while that was being computed, so it was re-read rather than overwritten.",
  /** The model turn exceeded its budget (504); the transcript is intact. */
  JOBSEEKER_TURN_TIMEOUT: "That reply took too long. Your conversation is saved; try again.",
  /** The deployment is sealed offline (KP_OFFLINE), so no source can be fetched (503). */
  JOBSEEKER_OFFLINE: "This install is offline, so job sources cannot be fetched.",
  /** The periodic scan cannot be armed before one manual scan succeeded (409): a new
   *  schedule is disabled until first verification. */
  JOBSEEKER_SCAN_UNVERIFIED: "Run one scan by hand first; the timer arms once a scan has succeeded.",
  /** GET /api/jobseeker/cv.pdf: the server could not render the designed CV — no
   *  headless browser installed, or the render failed or timed out (503; the cause goes
   *  to the server log). The client offers the browser's own print -> Save as PDF, which
   *  carries the same layout. */
  JOBSEEKER_PDF_UNAVAILABLE: "Could not make the PDF here. Use Print and choose Save as PDF: the layout is the same.",
  /** POST /api/jobseeker/cvs/[id]/use: the CV id is not one of THIS seeker's stored CVs
   *  (another seeker's, another workspace's, or none) - 404, never a hint which. */
  JOBSEEKER_CV_NOT_FOUND: "That CV is not among yours.",
  /** A /me write whose body is not the shape the route takes (a CV record without its
   *  draft, a design that is not an object, a cover note over its cap) - 400, nothing saved. */
  JOBSEEKER_REQUEST_INVALID: "That change was not in the expected shape, so nothing was saved.",
  /** DELETE /api/jds/[slug] on a description whose role is live (409). The library
   *  is the shelf of drafts; a live opening is the Roles tab's object and closing
   *  it there is the move that comes first. Deliberately not a 403: the caller has
   *  the authority, the ROW is not in a deletable state. */
  JD_LIVE_CANNOT_DELETE: "This description belongs to a live role. Close the role first, then delete it.",
  /** DELETE /api/jds/[slug] by someone who neither authored the JD nor holds an
   *  admin seat (403). See app/_lib/jds-delete-access.ts for the rule. */
  JD_DELETE_FORBIDDEN: "Only the person who created this description, or an admin, can delete it.",
  /** A JD slug does not resolve in this workspace (404). Same envelope as
   *  POSTING_NOT_FOUND so useErrorMessage localizes it instead of falling through
   *  to English "JD not found." */
  JD_NOT_FOUND: "That job description could not be found.",
  /** POST /api/jds and POST /api/jds/save: title or body missing after trim (400). */
  JD_FIELDS_REQUIRED: "A title and a description are both required.",
  JD_BUILD_TITLE_TOO_SHORT: "Role title must be at least 2 characters.",
  JD_BUILD_NEED_TOO_SHORT: "Describe the need in at least 11 characters so the AI has something to design from.",
  /** Title over JD_TITLE_MAX_LENGTH (400). */
  JD_TITLE_TOO_LONG: "The title must be 200 characters or fewer.",
  /** Body over JD_BODY_MAX_LENGTH (400). */
  JD_BODY_TOO_LONG: "The description must be 20,000 characters or fewer.",
  /** GET /api/glyphs/[id] with an id that is not a traced glyph (404). The art is
   *  decorative and the loader never renders this, but the answer is still a code. */
  GLYPH_UNKNOWN: "That illustration does not exist.",
  /** POST /api/profile (persist) building from an analysis whose CV already has a
   *  profile in this workspace (409). One profile per CV identity (the content hash
   *  analyses.cv_hash = profiles.source_cv_hash); `id` names the existing profile so
   *  the client opens it instead. A decision, not a fault: nothing was written. */
  PROFILE_EXISTS: "This CV already has a saved profile. Open that profile to edit it instead of creating a second one.",
  /** GET /api/devcase/[id] for a case that is not in the caller's workspace, or does not
   *  exist at all (404, the same answer for both: no existence oracle). */
  DEVCASE_CASE_NOT_FOUND: "That assignment is not in this workspace.",
  /** POST /api/analytics/targets (400): the metric is not a goal key on this workspace's
   *  LIVE board (unknown, a retired column, or the entry column, which has no inbound
   *  conversion). The key space is app/_lib/analytics-target-keys.ts. */
  ANALYTICS_TARGET_UNKNOWN_METRIC: "That column has no goal slot on this board. Goals apply to the board's live columns after the first one.",
  /** POST /api/analytics/targets (400): the value is not a finite non-negative number,
   *  or is over the key's ceiling in the goal-key registry. */
  ANALYTICS_TARGET_OUT_OF_RANGE: "That value is out of range. Use a number from 0 up to the field's limit (100 for a conversion goal).",
  /** POST /api/billing/alerts/[id] for an id that is not this org's alert, or no alert
   *  at all (404, one answer for both: no existence oracle). */
  BILLING_ALERT_NOT_FOUND: "That billing alert does not exist in this organization.",
  /** POST /api/billing/alerts/[id] for an alert that is already closed (409). The first
   *  resolution stands; a second call never re-kinds it. */
  BILLING_ALERT_NOT_OPEN: "That billing alert is already closed.",
  /** POST /api/billing/alerts/[id] whose `resolution` is not 'fixed' or 'dismissed' (400). */
  BILLING_ALERT_RESOLUTION_INVALID: "Say whether the billing alert was fixed or dismissed.",
  /** POST /api/ats/import named no job, or one the caller's team cannot see (404, one
   *  answer for both: no existence oracle across teams). */
  ATS_IMPORT_JOB_NOT_FOUND: "That role is not available to your team. Pick one of your team's roles to import into.",
  /** POST /api/ats/import whose `records` is not a list, is empty, or is longer than the
   *  per-call cap (400, with `maxRecords`). A connector pages; one call is never an account. */
  ATS_IMPORT_RECORDS_INVALID: "Send the applications as a list, at most 100 per import.",
  /** GET /api/pipeline/[id]/offer-letter on an entry whose approval is not an offer
   *  awaiting review (409): there is no drafted letter to preview. */
  OFFER_LETTER_NOT_PENDING: "There is no offer awaiting approval for this candidate, so there is no letter to preview.",
  /** POST /api/status/[token]/resend when nothing is waiting on the candidate (409): no
   *  open offer, no live booking invite, no untaken AI interview. The GET already says so
   *  (`nextAction: null`), so this reveals nothing new. */
  STATUS_NOTHING_TO_RESEND: "Nothing is waiting on you right now, so there is nothing to send again.",
  /** POST /api/status/[token]/resend whose re-send was attempted and did not go (502): the
   *  relay dead-lettered it. Said, never covered by the "on its way" sentence; the per-entry
   *  cooldown is released so the candidate can try again. */
  STATUS_RESEND_UNDELIVERED: "We could not send the email just now. Please try again later.",
  /** PATCH /api/analyses/[slug] moving a disposition TO advance without acknowledging
   *  every open trust warning on the stored analysis (409, with `pending`: the lines
   *  still unacknowledged). A note-only edit of a stored advance is never refused. */
  DISPOSITION_ACK_REQUIRED: "Acknowledge every open flag on this analysis before advancing the candidate.",
  // ---- Runtime failures stored on a task row (app/_lib/tasks.ts storedFailure). The
  // row is read later, in the reader's language, so the runner's own failures are kept
  // as codes (python-runner.ts spawnFailureCode) rather than English engine text.
  /** The engine's deadline killed the run's Python process (SpawnFailure kind timeout). */
  ENGINE_TIMEOUT: "The analysis engine took too long on this run and was stopped. Try again.",
  /** The run's Python process could not start, overflowed its output ceiling, or was
   *  stopped before it finished (SpawnFailure spawn_failed / output_overflow / aborted).
   *  The argv and the raw cause are in the server log, never here. */
  ENGINE_FAILED: "The analysis engine stopped before this run finished. Try again, and tell your administrator if it keeps happening.",
  /** The task runner stopped a run at its wall-clock budget (TASK_MAX_RUNTIME_MS), or
   *  reaped one left running with no live handler. */
  TASK_TIME_LIMIT: "This run went past its time limit and was stopped. Try again.",
  /** GET /api/me/capability-holders named no capability, or one the role model does
   *  not know (400). The shell only ever asks for a TAB_CAPABILITY value. */
  CAPABILITY_UNKNOWN: "That permission does not exist.",
  /** POST /api/interview-prep/scorecard?debrief= (400): an adverse debrief finding (revised /
   *  not evidenced) must carry the candidate's own words. */
  DEBRIEF_FINDING_QUOTE_REQUIRED: "A finding that goes against the candidate needs a quote of what they said.",
  /** The same door (400): an unknown follow-up or finding kind. */
  DEBRIEF_FINDING_INVALID: "That debrief finding does not match any follow-up on this submission.",
  /** The same door (409): no findings were recorded for this evaluation, or fewer than four in five were supported. */
  DEBRIEF_CLEARANCE_REFUSED: "Authorship cannot be cleared yet: record a finding for each follow-up first, and at least four in five must be supported.",
  /** The same door (409): the submission is not under an authorship hold (or the clearance already stands). */
  DEBRIEF_NOT_HELD: "This submission is not being held for an authorship check.",
  /** POST /api/interview-prep/scorecard (409): the candidate's prep already holds
   *  MAX_HUMAN_SCORECARDS records, one per (interviewer, round), and this save would
   *  open a new one. Refused rather than made room for — evicting an older record is
   *  exactly the loss the per-interviewer list exists to prevent
   *  (app/_lib/human-scorecard-set.ts). An interviewer re-saving their own record is
   *  never refused. */
  INTERVIEW_PREP_SCORECARDS_FULL: "This candidate already holds as many interview scorecards as can be stored. Your scorecard was not saved.",
  /** POST /api/voice/readiness under KP_OFFLINE (503): a probe mints at the providers,
   *  which a sealed install must not reach. The GET says `offline` so the strip never
   *  offers the button. */
  VOICE_READINESS_OFFLINE: "This server runs offline, so voice providers cannot be checked.",
  /** POST /api/stop/[token]/language named no locale, or one the app does not write
   *  letters in (400). Nothing is stored. */
  STOP_LANGUAGE_INVALID: "That language is not one we can write to you in.",
  /** POST /api/devcase/[id]/intake (409): the case's newest lifecycle is still running and
   *  owns intake. Its own Close ends intake AND wraps the submitters up; the hand stop
   *  notifies nobody, so it must not end a run's intake behind its back. `stage` rides as
   *  data. */
  DEVCASE_INTAKE_LIFECYCLE_OWNS: "An automated run owns this assignment’s intake. Close the run instead; that also wraps up its submitters.",
  /** POST /api/devcase/[id]/intake (400): the body named an action other than "stop". A
   *  reopen is an ordinary POST /api/devcase/publish. */
  DEVCASE_INTAKE_ACTION_UNKNOWN: "That is not an intake action this assignment supports.",
  // --- Gigs module (/api/gigs/**, docs/features/gigs/README.md) ---------------------
  /** The gig in the URL is not in this workspace (404). */
  GIG_NOT_FOUND: "That gig does not exist.",
  /** The honeypot scan flagged the listing; dispatch waits for the operator to clear it (409). */
  GIG_SUSPECT: "This listing was flagged as suspicious, so it cannot be sent to a specialist. Review the flag first.",
  /** The gig's status is not one a dispatch starts from (qualified, drafted, in review) (409). */
  GIG_NOT_DISPATCHABLE: "This gig cannot be sent to a specialist in its current state.",
  /** No specialist in the arena, or its Personas hire is not running yet (409). */
  GIG_SPECIALIST_NOT_READY: "No specialist is ready for this gig yet. Hire one, then wait until Personas has approved it.",
  /** Personas did not accept the assignment (502); the attempt is recorded `failed` with
   *  the transport's reason code, and the gig is back to qualified. */
  GIG_DISPATCH_FAILED: "Personas did not accept the assignment. The attempt was recorded as failed, and the gig can be sent again.",
  /** A body field is missing or malformed (400); `field` names it. */
  GIG_INPUT_INVALID: "Some of the details sent for this gig are missing or not valid.",
  /** The gig or attempt is not in a state the requested action starts from (409). */
  GIG_ACTION_NOT_ALLOWED: "That action is not available for this gig in its current state.",
  /** The row moved between the read and the write; the CAS dropped the change (409). */
  GIG_STATE_CHANGED: "This gig changed while that was being saved, so nothing was overwritten. Reload and try again.",
  /** The attempt in the URL is not in this workspace (404). */
  GIG_ATTEMPT_NOT_FOUND: "That draft does not exist.",
  /** Dispatch of a gig with no accepted plan (409): the operator accepts one of the
   *  models' plans first (gig-mastery S1). */
  GIG_PLAN_NOT_ACCEPTED: "Accept one of the plans for this gig before sending it to an agent.",
  /** Dispatch refused because the source says the listing no longer takes proposals -
   *  awarded, frozen, closed or removed (409, `detail` = the state; gigs/freshness.ts). */
  GIG_SOURCE_CLOSED: "This listing no longer takes proposals on its source, so it was not sent to an agent.",
  /** The plan in the URL is not this gig's, or not in this workspace (404). */
  GIG_PLAN_NOT_FOUND: "That plan does not exist.",
  /** A second plan accepted for a gig that already has one (409). */
  GIG_PLAN_ALREADY_ACCEPTED: "A plan is already accepted for this gig.",
  /** mark_sent without the AI-use disclosure ticked on the review (422). */
  GIG_DISCLOSURE_REQUIRED: "Tick the AI-use disclosure before marking this work as sent.",
  /** A revision request with no note saying what to change (400). */
  GIG_REVISION_NOTE_REQUIRED: "Write a note saying what to change before asking for a revision.",
  /** An outcome for a gig (or attempt) that was never sent (409). */
  GIG_OUTCOME_NOT_SENT: "An outcome can only be recorded for work that was sent.",
  /** The gig source in the URL is not in this workspace (404). */
  GIG_SOURCE_NOT_FOUND: "That gig source does not exist.",
  /** A tier-C adapter (or one with no source to fetch, like manual) cannot be added (403). */
  GIG_SOURCE_REFUSED: "This source cannot be added: its terms or its host rule out automated access.",
  /** The acknowledged terms hash is not the catalog's current one (409, with `termsHash`). */
  GIG_SOURCE_TERMS_CHANGED: "This source’s terms summary changed since it was acknowledged. Read the current terms and acknowledge them again.",
  /** Resuming a tier-B source whose terms were never acknowledged, or were acknowledged
   *  under an older summary (409, with `termsHash`). */
  GIG_SOURCE_TERMS_REQUIRED: "Read and acknowledge this source’s terms before resuming it.",
  /** The gig's workspace could not be prepared (gigs/project.ts): its folder could not be
   *  made (500), or Personas refused or could not be reached to register the gig's project
   *  (502). `detail` is the reason code. A dispatch refused this way claimed nothing. */
  GIG_WORKSPACE_FAILED: "The gig’s working folder or its Personas project could not be prepared, so nothing was sent. Check the Personas connection and try again.",
  /** PATCH /api/gigs/[id] `route` (409): the specialist works a different arena than the
   *  gig's, so it cannot take it (gigs/routing.ts). */
  GIG_ROUTE_ARENA_MISMATCH: "That specialist works a different arena than this gig, so the gig cannot be routed to it.",
  /** GET /api/gigs/[id]/report (404): no report file yet - one is written once the gig is
   *  researched (gigs/report/run.ts) - or the recorded file is gone. */
  GIG_REPORT_NOT_FOUND: "This gig has no report yet. It is written once the gig is researched.",
  /** POST /api/gigs/[id]/dispatch (409), and the pairing: a freelance gig is the PROPOSAL
   *  track (types.ts gigTrackOf) - kp prepares a client proposal, never the work, so no
   *  persona is paired or run. Nothing was written. */
  GIG_PROPOSAL_TRACK: "This is a freelance bid: kp prepares a proposal, not the work.",
  /** GET /api/gigs/[id]/proposal (404): no client proposal yet - one is written when a plan
   *  is accepted, or on request (gigs/proposal/run.ts) - or the recorded file is gone. */
  GIG_PROPOSAL_NOT_FOUND: "This gig has no client proposal yet. It is written when a plan is accepted, or on request.",
} as const;

export type RefusalErrorCode = keyof typeof REFUSAL_ERRORS;
