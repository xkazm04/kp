# Voice Interview — AI-led first-round screening

An in-browser, voice-driven first-round interview. A candidate opens a
tokenized link, talks to an AI interviewer in real time, and the transcript
feeds scoring/scorecard and the pipeline. Two swappable realtime providers
back the same UI and consent/telemetry pipeline: **OpenAI Realtime** and
**ElevenLabs Agents** (which can also point at a self-hosted, no-per-minute
voice service — see [Self-hosted voice](#self-hosted-voice)).

## Entry points

- Candidate portal: `app/interview/[token]/page.tsx` (+ `error.tsx`,
  `loading.tsx`) — the real, token-bound candidate flow. Revoked and expired
  links paint distinct closed cards (`interview.revokedTitle` /
  `revokedBody` vs `expiredTitle` / `expiredBody`) so the candidate's next
  mail names the actual reason.
- Recruiter dev/demo harness: `app/interview-lab/page.tsx` — a keyless lab for
  trying the agent as a recruiter would; gated by `INTERVIEW_LAB_ENABLED=1`
  outside production.
- Recruiter-triggered simulation: `app/features/tools/interview/InterviewSimTab.tsx`,
  `InterviewStartPanel.tsx`, `InterviewModeCards.tsx`,
  `InterviewAttachToCandidate.tsx` → `app/api/interview/simulate/route.ts`.

## Flows

0. **Automatic creation on stage entry.** A candidate who *enters* a board column
   whose hiring-plan round is run by the AI no longer waits for a recruiter to
   press "Create link" — see [Automatic invites on stage
   entry](#automatic-invites-on-stage-entry) below. The mint itself is the same
   door in both cases.
1. **Session creation.** A real candidate session is minted via
   `app/api/interview/create/route.ts` (entry-backed, `mode="candidate"`,
   produces a scorecard on completion). The route owns the transport half —
   the cheap `interview_minutes` pre-gate, body validation, the per-IP throttle,
   `submissionId` → entry resolution — and hands the work to
   **`mintAndInviteVoiceScreen` (`app/_lib/interview-invite.ts`)**, the one
   server-side door that holds the live-call guard, the grounded build, the
   authoritative billing reservation, revoke-then-create and the truthful invite
   dispatch. That door is shared verbatim with the stage hook, so the recruiter's
   button and the automatic path can never disagree about reissue semantics,
   spend, or what `delivery` claims. A recruiter demo/simulation goes
   through `app/api/interview/simulate/route.ts` (`mode: "student" |
   "student-case" | "regular"` picks the brief and run-of-show); both are
   billing-metered the same way (`interview_minutes`).
   The invite `/create` emails is rendered in the applicant's own language
   (`pipeline_entries.locale`, SIM3) **and carries that locale on the link** as
   `?lang=<locale>` — the `proxy.ts` locale override every other candidate link
   already uses (`/status`, `/data`, the enrichment link). It is load-bearing,
   not cosmetic: an emailed absolute link arrives with no `NEXT_LOCALE` cookie,
   the candidate portal hides the language picker and seeds the spoken-agent
   language hint from its rendered UI locale, and that hint pins OpenAI Realtime
   input-audio transcription (`buildOpenAiSessionPayload`) — where transport
   config beats the brief's prompt-level language lock. Without `?lang=`, a
   Czech applicant read a Czech invite, landed on an English portal, and was
   transcribed against an English ASR while the brief had been told to open in
   Czech. The `url` in the JSON response stays unpinned on purpose — the
   recruiter opens that one, and `?lang=` would rewrite their console's locale.
2. **Connect.** The browser calls `app/api/interview/connect/route.ts`, which
   validates the token, mints short-lived provider credentials
   (`getVoiceAdapter`, `connectWithFailover`), and — for candidate-mode
   sessions only — hands back the candidate-safe brief
   (`buildCandidateSafeBrief` in `app/_lib/interview-run.ts`) as an
   ElevenLabs prompt override. A tokenless/lab connect gets no brief and the
   ElevenLabs dashboard-configured agent prompt runs instead.
   The ElevenLabs override is **client-sent** (it transits the candidate's
   browser), so everything in it passes the allow-list sanitizers in
   `app/_lib/voice/candidate-brief.ts`: a candidate-safe block is constructed
   from scratch out of the topic label, the questions asked aloud and the
   time-boxes — `goal`, `listenFor`, `redFlag`, coachability stage directions
   and any future private field cannot survive. Picking the *field* is not
   enough for the topic: `session.runOfShow` **is** `chronology[].topic`, whose
   text is the LLM's free-form `competency` and routinely carries gap verdicts
   (`"Test automation fundamentals (missing must-have)"`), so
   `candidateSafeTopic()` also scrubs the label's **content** — bracketed asides
   are removed by shape (not by phrase vocabulary) and the label is
   length-capped. Pinned by `app/_lib/voice/candidate-brief.test.ts`.
   The **stored** `interview_sessions.run_of_show_json` is composed through the
   same scrub at the source (`candidateRunOfShow` in
   `app/_lib/interview-run.ts`, called by `buildGroundedInterview`), so every
   reader of that field is clean at once — the portal's agenda sidebar
   (`app/interview/[token]/page.tsx`), `/api/interview/simulate` →
   `InterviewSimTab`, and `scripts/interview-brief-grounded.ts`. The
   **interviewer** brief (`composeBrief`) deliberately keeps the raw topic: it
   is server-side and interviewer-internal, which is why
   `/api/interview/complete`'s public projection strips it. Pinned by
   `app/_lib/interview-run.test.ts`. That reply carries **no scorecard** either:
   it goes to the candidate's own browser, and the scorecard is the AI's verdict
   about them (`recommendation`, ratings, summary). It rode every reply until
   2026-09-18; recruiters and the voice eval harness now read it through
   `/api/interview/by-entry` (`complete-response-projection.test.ts`).
3. **Live call.** `app/_components/voice/VoiceInterview.tsx` (+
   `VoiceInterviewClient.tsx`, `InterviewSidebar.tsx`) drives either adapter —
   the two realtime transports live side by side under
   `app/_components/voice/transport/` (`openai.ts` raw WebRTC, `elevenlabs.ts`
   the SDK hook) while the component keeps the shared shell (phase, consent,
   transcript, finalize). It
   sends `overrides.agent.language` (candidate locale — any of the four shipped
   locales via `portalLanguageHint`; it used to collapse everything that was not
   Czech to English, pinning English into a German or French applicant's agent
   language and OpenAI transcription language) to ElevenLabs so the
   agent doesn't default to its Czech dashboard language, shows a live
   speaking/listening indicator for both providers, recovers from a
   transient network drop without freezing the mic, and offers a pre-call mic
   test (its verdict sits in a persistent `aria-live` region, so a
   screen-reader candidate hears "we can hear you" / "we didn't detect any
   sound" rather than nothing).
   Three render-side properties belong to this layer rather than to the
   session builders:
   - `InterviewSidebar.tsx` maps every agenda label through
     `candidateSafeTopic()` before rendering it. This is deliberate
     belt-and-braces beside the source-side `candidateRunOfShow` scrub above:
     `run_of_show_json` rows persisted *before* that scrub still hold raw
     annotated topics, and the sidebar is a shared component the simulator tab
     feeds from a different source.
   - A microphone failure reads the same on both transports. The ElevenLabs SDK
     acquires the mic itself and reports a rejected `startSession` through
     `onError(message, error)`; the transport forwards that second `cause`
     argument so `micErrorText.ts` can match the real `DOMException.name` and
     show the same localized recovery copy the OpenAI path already showed —
     previously an EL mic denial surfaced the SDK's untranslated
     `"Permission denied"`.
   - `useTranscriptPersistence.ts` stashes each transcript POST body in
     `sessionStorage` under `kp.iv.<sessionId>` *before* sending it, and
     **replays any stash left over on mount**. A 2xx or a terminal 4xx (already
     completed / bad token / consent) clears the stash; a network failure — or a
     429 from `/complete`'s throttle, which is explicitly temporary — keeps
     it for the next mount, so a reload after the "we couldn't save your
     interview" banner recovers the record instead of dropping it.
4. **Completion.** `app/api/interview/complete/route.ts` persists the
   transcript, computes `interviewFinalStatus`
   (`app/_lib/voice/finalize-status.ts`), attributes usage/cost
   (`app/_lib/voice/minute-prices.ts` → `voiceUsageRow`), and — for
   entry-backed sessions — runs `interview_scorecard()`
   (`pipeline/jobfit/automation.py` via `app/_lib/interview-run.ts`).
5. **Brief composition.** `app/_lib/student-interview.ts` holds the shared
   persona constants (`PERSONA_LANGUAGE_DETECT`, `PERSONA_CRAFT_RULES`,
   `PERSONA_ONE_QUESTION`, `PERSONA_GENDER_GRAMMAR`) and brief builders
   (`defaultInterviewerInstructions`, `composeBrief`,
   `caseGroundedInterviewerInstructions`, `studentInterviewerInstructions`);
   `app/_lib/interview-prep.ts` / `interview-prep-run.ts` assemble the
   grounded prep-chronology brief from a pipeline entry. Jobs promoted from a
   role-intake conversation additionally ground the experienced-path brief on
   the requestor's stated intent — `composeBrief`'s `roleIntent` parameter
   carries `briefIntentSummary(promotedBriefForJob(jobId, …))` (90-day
   outcomes + dealbreakers, interviewer-internal; the candidate-safe brief
   deliberately omits it). See `docs/features/intake/README.md`.

## Director protocol & agenda

The realtime provider still runs each spoken turn, but every candidate interview that
has something grounded to talk about is **directed from our server**: one agenda,
built at connect, that both providers' briefs list and that the director validates
tool calls against. Before this, OpenAI ran the brief frozen on the session at invite
time while ElevenLabs ran a candidate-safe brief rebuilt from the current prep, so the
two providers could disagree about the topics a candidate was asked.

### Entry points

| Where | What |
| --- | --- |
| `POST /api/interview/connect` (`app/api/interview/connect/route.ts`) | Builds the agenda for candidate-mode, entry-backed sessions, persists it, composes both briefs from it, mints the provider session (OpenAI gets the director tools + semantic VAD), and returns the agenda's candidate view. |
| `app/_lib/interview-agenda.ts` | `buildInterviewKit` / `buildInterviewAgenda` (read-only), `toCandidateAgendaView`, `reconcileKitWithStoredAgenda`, `fitAgendaDrafts`. |
| `app/_lib/voice/director-brief.ts` | The director section of every directed brief: leadership frame, agenda listing (candidate allow-list vs private), tool protocol, `[Director]` rule, ROLE FACTS, resumed-call addendum. |
| `app/_lib/interview-run.ts` | `buildGroundedInterview(entryId, ws, { readOnly, kit, resume })` (private brief) and `buildCandidateSafeBrief(entryId, { kit, resume })`. Without options both produce the pre-director brief, which is what `/api/interview/create` still stores as the fallback snapshot. |
| `app/_lib/voice/director-tools.mjs` | The five tools (`begin_topic`, `mark_topic_covered`, `report_guardrail`, `forward_question`, `end_interview`) and `DIRECTOR_NOTE_PREFIX` (`[Director]`), shared by both providers. |
| `scripts/setup-eleven-agent.mjs` | `--deploy` creates or reuses the five tools as ElevenLabs **client** tools and references them in `conversation_config.agent.prompt.tool_ids`. `--check` follows those ids and diffs each tool's config (`app/_lib/voice/eleven-agent-diff.mjs`). |

### Flow at connect

1. The usual guards run first (token, lifecycle, one live call, throttle, consent),
   then `markInterviewStarted`. The connect's `attempt` is read after the start
   (1 on the first call, 2 after a drop).
2. `recordingConsent: true` in the body stamps `recording_consent_at`
   (`markInterviewRecordingConsent`), but only when `isInterviewRecordingOffered(workspace)`
   says the workspace offers recording. Only a literal `true` counts.
3. `buildResumeContext(sessionId, workspace)` reports an earlier attempt, if there
   was one.
4. `buildInterviewKit(entryId)` builds the agenda from the entry's current kit. It is
   read-only and never generates a missing prep, because this is a public door. On a
   resumed attempt the stored agenda wins, since the resume state's block ids were
   recorded against it. The agenda is persisted with `setInterviewAgenda`.
5. Both briefs are composed from that one agenda: the private brief (goals,
   listen-fors, scripted hints, raw competency, role intent) for OpenAI, and the
   candidate-safe brief for the ElevenLabs client-sent override. A resumed attempt
   appends the resumed-call addendum to both.
6. If nothing could be built, OpenAI keeps the stored `instructions` snapshot and
   ElevenLabs keeps the generic candidate-safe prompt. Neither gets tools.

### The agenda

The agenda has the same branch order as the grounded brief: **submission debrief >
case-grounded student > generic student > prep chronology**. It is null when there is
nothing to direct.

- **Blocks.** A leading `warmup` block asks one easy, unassessed question in the
  entry's language (`interview.brief.agendaWarmupQuestion`). Then come the kit's
  `topic` blocks, plus the kit's `open` block when it has one. The agenda ends with
  `role_qa` (at least 2 min) and `close` (at least 2 min: the read-back, then
  `end_interview` and the goodbye).
  - A prep chronology already has a fixed opening and closing, and these become the
    warm-up and the `role_qa` + `close` pair rather than being duplicated.
  - Imported interview-kit questions get a block of their own.
  - The debrief gets one block per minted authorship question ("Decision n").
  - The student scripts get one block per phase.
- **Budgets.**
  - The booked length is an input. It is the session's `duration_min`: what the
    portal promised the candidate, and what the minutes debit clamps against. The
    kit's own length (prep, script or debrief) is used only when a session has none.
    Fixed blocks come off first, and the kit is fitted into the rest.
  - Slack goes to the `open` block, or to `role_qa` when there is no `open` block.
  - An overrun is taken from the `open` block first, then from the warm-up, then
    spread proportionally across the topic blocks. It never comes out of the closing
    reserve.
- **Invariants.** These are pinned by `interview-agenda.test.ts`:
  - Block ids run `b0..bN` in order.
  - Σ budget = `durationMin`.
  - `hardCapMin = round(durationMin × 1.2)`.
  - `closeReserveMin = role_qa + close`.
  - `scored` is true only for `topic` and `open`.
- **Candidate-safety.**
  - Titles come from the catalog (`interview.brief.agenda*`, 4 locales) or are kit
    labels scrubbed by `candidateSafeTopic`.
  - Questions pass the allow-list sanitizers in `voice/candidate-brief.ts`, so the
    coachability hint is never an aloud question.
  - `competency` is the raw kit competency and stays server-side.
  - `toCandidateAgendaView` is a projection that carries only `id`, `kind`, `title`
    and `budgetMin`.

### The brief's director section

The section is written as constraints rather than extra conversational moves
(registry: ai-interviewer-brief-authoring, rule-ordering-adjacency-and-form). The
persona block is unchanged: one question, craft, then gender grammar and the language
lock, adjacent. The agenda replaces the old run-of-show listing, so it is never listed
twice. In order:

- **Leadership frame.** This comes right after the AI self-disclosure: "you will lead
  them through N short topics in about X minutes and may move things along to keep
  time".
- **Agenda listing.** Each block appears as `bN · title (budget min)`. The private
  brief adds `Evidence for: <competency>` and the kit note. The candidate brief lists
  aloud questions only.
- **Protocol.** It sits after the agenda and before the no-judgement close:
  - Call `begin_topic` on every block.
  - Call `mark_topic_covered` with the candidate's exact words.
  - Coverage comes first, then the clock.
  - A score or feedback request, an instruction override, a disclosure request, or
    repeated off-topic pulling gets a one-sentence decline plus `report_guardrail`.
  - Role questions are answered only from ROLE FACTS; anything else goes to
    `forward_question` with "the recruiter will follow up".
  - `end_interview` is called after the close block.
  - `[Director]` messages are private directions: follow them, and never read them
    aloud.
- **ROLE FACTS.** Title, company, location and work mode, plus the job's posting text
  (`description`, capped at 1500 chars). The posting text is included only while the
  job is publicly live (`isJobOpenForApplications`: a seeded row or `published`), so a
  draft's text never reaches a candidate. Next steps are stated generically: "a
  recruiter reviews this conversation and contacts the candidate about next steps".
- **Resumed-call addendum.** This applies only to a reconnect. It says:
  - no second introduction;
  - continue at the active block, or the first uncovered one;
  - which blocks are already covered;
  - roughly how many minutes have already been used;
  - the last four spoken turns, quoted as transcript and never as instructions.

  System turns and `[Director]` turns are never quoted.

### Provider specifics

- **OpenAI.** The session config minted by `buildOpenAiSessionPayload` does two
  things:
  - When the directed brief was built, it carries the tools as GA function tools
    (`{ type: "function", name, description, parameters }`) with
    `tool_choice: "auto"`.
  - Every non-relay session uses
    `audio.input.turn_detection = { type: "semantic_vad", eagerness }`.
    `OPENAI_REALTIME_TURN_EAGERNESS` sets the eagerness (`low|medium|high|auto`). The
    default is `low`, and an invalid value falls back to `low`.

  Relay mode (role intake) is byte-unchanged.
- **ElevenLabs.** Tools are workspace resources that the agent references by
  `tool_ids`. Inline `prompt.tools` was removed from the API in July 2025. Each tool
  is a client tool with `expects_response: true` and `response_timeout_secs: 10`.
  Every property carries the contract's own description, because the API requires one
  per property; a generated "One of: …" line covers any property the contract leaves
  undescribed. Deploying is an operator step that needs an API key; see
  `node scripts/setup-eleven-agent.mjs --check` / `--deploy`.

### Response additions (`/api/interview/connect`)

| Field | Meaning |
| --- | --- |
| `agenda` | `CandidateAgendaView \| null`: block ids, kinds, titles and budgets only. |
| `attempt` | This connect's attempt number (`interview_sessions.attempts` after the start). The browser stamps it on every director POST. |
| `resume` | `ResumeContext \| null`. Non-null on a reconnect after a drop. |
| `recording` | `{ offered: boolean }`: whether the workspace offers an audio recording. |

Every existing field, refusal and limit is unchanged.

### Keyless behaviour

The agenda, both briefs and the candidate view are built without any key or model
call. They are pure composition over stored rows and the catalog, so a keyless
install still gets directed briefs. It simply cannot mint a provider session (the
existing `INTERVIEW_PROVIDER_UNCONFIGURED` 503). If nothing is grounded, the call runs
exactly as before this feature.

### Known gaps

- The case-grounded student interview narrates its scenario after the warm-up, and
  that narration has no minutes of its own in the agenda. It comes out of the 20%
  hard-cap slack.
- If the prep is regenerated to a longer plan after the invite, its topics are
  squeezed into the booked length. That is 1 minute per topic at the floor. The
  agenda states a longer total only when even those floors cannot fit.

## Director engine

The candidate interview keeps the realtime provider's own model for each spoken turn
(sub-second speech-to-speech) and adds **our director** around it
([ADR 0010](../../architecture/decisions/0010-candidate-interview-keeps-provider-brain-plus-director.md)).
The director keeps the record, holds the clock and injects stage directions. It never
writes the interviewer's words. The leadership policy is **coverage first, then clock**.

### Flows

1. **An exchange.** During the call the candidate's browser posts
   `POST /api/interview/director` with the turns finalized since the last acknowledged
   seq, the browser-only observations (`focus_lost`, `focus_returned`,
   `answer_timing`) and at most one tool call the model is waiting on. The server,
   inside one IMMEDIATE transaction:
   1. persists the new turns, tagged with the active block. A turn is idempotent per
      `(session, attempt, seq)`, so a retried POST changes nothing.
   2. applies the tool call and records it.
   3. derives the state (active block, covered blocks, live time) from the record and
      decides at most one stage direction. The direction is recorded too, so the dedupe
      still works across requests.
   4. answers `{ ok, ackSeq, toolResult, directive, agenda: { activeBlockId,
      coveredBlockIds }, endCall }`.

   The browser injects `directive.text`, which already carries the `[Director]`
   prefix, into the provider session unchanged. It hands `toolResult` back to the
   model as the tool's output. When `endCall` is true, it ends the call once the
   interviewer's current utterance finishes. It resends every turn above `ackSeq`.
2. **Tool calls** (`app/_lib/voice/director-tools.mjs`).
   - `begin_topic`: records `topic_begun` for a known block id. An unknown id gets
     "continue", and a covered block is refused.
   - `mark_topic_covered`: accepted only when `evidence_quote` (trimmed, at most 400
     characters, at least 3 words) matches a **persisted candidate turn** of the session.
     The match ignores case, punctuation, diacritics and whitespace. The quote must sit
     inside what the candidate said, or across two adjacent candidate turns. Otherwise
     at least 60% of its distinctive words (and at least 2) must appear in one turn
     (`app/_lib/quote-match.ts`).
     - Accepted: `topic_covered`.
     - Rejected: `topic_cover_rejected` with a `reason` of `empty`, `too_short`,
       `too_long` or `no_match`. The model is told the evidence was not recorded and
       that it should ask one narrower question for a concrete instance.
   - `report_guardrail`: records `guardrail` as `{kind, quote, verified}`, where
     `verified` means the quote matched the candidate's persisted words. It is an
     observation only. It is never scored and never a reason to act.
   - `forward_question`: records `candidate_question`.
   - `end_interview`: records `end_requested` and answers `endCall: true` for the rest
     of that attempt. There is one exception, because the interviewer leads with
     coverage first: reason `complete` is **refused** while all three of these hold:
     - a scored (`topic`/`open`) block is still uncovered;
     - elapsed is below hardCap − closeReserve;
     - the closing block has not begun.

     A refused call is still written as an `end_requested` row with
     `payload.refused: true` (and `remaining`), so it stays on the audit trail. That row
     never ends the call. The model is told `Not yet — N topics remain. Continue with
     bX · <title>.` Reasons `time` and `candidate_request` are always accepted: the
     candidate may stop whenever they want.
   - Every tool event stores its `callId` and the result it was given. If a retried POST
     sends the same call again, it gets the same answer and nothing new is recorded.
3. **A reconnect.** `buildResumeContext(sessionId, workspaceId)` (`voice/resume.ts`)
   returns the earlier attempts' most recent 40 turns, the active and covered blocks,
   the live seconds already spent and the attempt being resumed into. Call it **after**
   `markInterviewStarted` has counted the reconnect. The first exchange of a resumed
   attempt also gets one `resume` direction naming the block to continue with.
   **Billing a resumed call.** `/api/interview/complete` normally bills only the
   current attempt, so a next-day retry of a dead link is not charged for the gap. A
   resumed directed call is different: its earlier attempt finalized `failed` on
   purpose so the candidate could continue, and those minutes were spoken. Its
   completion therefore bills `resumedCallElapsedMs` (`voice/resume.ts`), the
   director's clock summed across every attempt with the gaps left out, still clamped
   to 2× the booked length. Pinned in `complete-reconnect-billing.test.ts`.

### Directive policy

The time arithmetic runs on the **server clock only**. The time for each attempt is
measured from its first event, or from its connect if that is earlier, to its last
event. The current attempt runs to now. The gaps between dropped attempts don't count.

Slack = hardCap − closeReserve − elapsed − Σ budgets of blocks not yet started. The
closing blocks are left out of that sum because the close reserve already holds them.

| Condition (highest priority first) | Directive |
| --- | --- |
| elapsed ≥ hardCap + 2 min | `end_now`, and `endCall: true` |
| elapsed ≥ hardCap − closeReserve, and neither role questions nor closing has begun | `close_now` naming the first role-questions/closing block |
| first exchange of a reconnected attempt | `resume` naming the active block (or the next one) |
| active block under its budget | nothing (coverage first) |
| active `topic`/`open` block at budget, uncovered, no narrowing sent yet | `stay_narrow` (once per block) |
| overrun ≥ 50% of the budget, or slack ≤ 0 (and any `stay_narrow` is more than 60 s old) | `move_on` naming the next unstarted, uncovered block |
| the same (kind, block) already sent within 60 s | nothing |
| no agenda | nothing, ever |

Warm-up, role-questions and closing blocks never get `stay_narrow`. Directive text names
blocks by id and candidate-safe title only, never a competency, question or goal,
because it passes through the candidate's browser.

### API / lib surface

| Surface | Role |
| --- | --- |
| `POST /api/interview/director` (`app/api/interview/director/route.ts`) | Public token route. Body capped at 64 KB. Per-token limit of 240 per 10 min (`interview-director:<token>`). The tenant is the session's own workspace. |
| `app/_lib/voice/director-step.ts` | Parses the untrusted request (at most 50 turns and 20 observations per request, turns clamped like the hang-up transcript) and runs one exchange in one IMMEDIATE transaction. |
| `app/_lib/voice/director.ts` | Pure policy: `deriveDirectorState`, `decideDirective`, `applyDirectorTool`. No DB, no clock. |
| `app/_lib/voice/resume.ts` | `buildResumeContext` for `/connect`. |
| `app/_lib/quote-match.ts` | Shared, pure quote-to-turn matcher. |
| `app/_lib/db/interview-events.ts` | `appendInterviewEvents`, `listInterviewEvents`, `maxInterviewTurnSeq`, `withInterviewEventsLock`. |

Refusals, all coded:

| Condition | Status | Code |
| --- | --- | --- |
| No token | 400 | `INTERVIEW_LINK_NOT_FOUND` |
| Unknown token, or a `sessionId` that is not the token's | 404 | `INTERVIEW_LINK_NOT_FOUND` |
| Session completed | 409 | `INTERVIEW_ALREADY_COMPLETED` |
| Session revoked | 409 | `INTERVIEW_LINK_INACTIVE` |
| Session never connected, a dropped call, or a stale `attempt` | 409 | `INTERVIEW_NOT_LIVE` |
| Candidate session with no consent on record | 403 | `INTERVIEW_CONSENT_REQUIRED` |
| Body over 64 KB | 413 | `PAYLOAD_TOO_LARGE` |
| Over the per-token rate limit | 429 | `TOO_MANY_REQUESTS` |
| Any store failure | 500 | `INTERVIEW_DIRECTOR_FAILED` |

### Data model

`interview_events` is append-only. The only other write is the GDPR erasure `DELETE`.

| Column | Meaning |
| --- | --- |
| `id` | Primary key |
| `session_id` | The interview session |
| `workspace_id` | The tenant |
| `attempt` | The connect the event belongs to |
| `seq` | Per-attempt turn number (turns only) |
| `kind` | One of `INTERVIEW_EVENT_KINDS` |
| `block_id` | The agenda block, when there is one |
| `payload_json` | The event's fields |
| `at` | When it happened: the browser stamp, clamped to the server clock |
| `created_at` | When the server recorded it |

Indexes: a unique index on `(session_id, attempt, seq) WHERE kind = 'turn'`, and an
index on `(session_id, at)`.

What each kind's payload holds:

| Kind | Payload |
| --- | --- |
| `turn` | `{role, text}` |
| `topic_covered` | `{quote, callId, toolResult}` |
| `topic_cover_rejected` | `{quote, reason, …}` |
| `guardrail` | `{kind, quote, verified, …}` |
| `candidate_question` | `{question, …}` |
| `end_requested` | `{reason, …}` |
| `directive` | `{directiveId, kind, text}` |
| `focus_lost` | `{during}` |
| `focus_returned` | `{awayMs}` |
| `answer_timing` | `{turnSeq, preSilenceMs, durationMs}` |

The table is workspace-scoped in `app/_lib/tenancy.ts`, with the proof in
`interview-events-tenancy.test.ts`. The append is an INSERT…SELECT against the session
row in the same workspace. Erasure (`scrubEntryLinkedPii`) deletes every event of the
erased entry's sessions. A session stops storing new events once it has 4000.

### Keyless and failure behaviour

- **No agenda** (a pre-director session, or an agenda that failed to build): the
  exchange still records turns and tool calls, but no direction is ever sent and there
  is no clock-driven end.
- **Every tool failure answers "continue".** A malformed call (unknown name, bad or
  unparseable arguments, unknown block, invalid enum) gets `Continue with the agenda.`
  and nothing is recorded. The handler never throws to the model.
- **A director outage never stalls a call.** Any non-2xx, including the coded 500, is
  answered "continue" to the waiting model by the browser, and the call goes on
  undirected. The transcript still reaches `/complete` at hang-up as before.
- **The director needs no LLM and no key.** It is deterministic server code. Directions
  are advisory: the provider's model can ignore one. The director repeats a direction
  at most once every 60 s, and at hard cap + 2 min it ends the call through the browser.

### Known gaps

- If OpenAI Realtime's input transcription arrives after the model's
  `mark_topic_covered` call, a true quote is rejected as `no_match`. The model is then
  told to ask again, which costs one question.
- ~~A directed call longer than `LIVE_INTERVIEW_RECENCY_MIN` stopped counting as
  live~~ — fixed: every director exchange stamps `interview_sessions.last_activity_at`
  (`touchInterviewActivity`), and `isInterviewSessionLive` reads the later of it and
  `updated_at`. `updated_at` stays the connect time, because the minutes debit and the
  director's clock read it as the current attempt's start.
- ElevenLabs sessions stay undirected until the agent is re-provisioned with the client
  tools.

## Automatic invites on stage entry

**The one manual step left in the AI-interview loop is gone.** When a candidate
comes to *stand* on a board column whose hiring-plan round is run by the AI, the
system mints the voice screen and invites them — immediately when that column's
gate is `auto`, parked for a human when it is `human`.

**Where it hangs.** `app/_lib/stage-hooks.ts`, called from the two writers in
`app/_lib/db/pipeline.ts` that are the *only* places a pipeline entry's stage
changes — `actOnPipelineEntry` (accept / approve_event / the automation pass /
the offer finalizer) and `setPipelineEntryStage` (the recruiter's manual override,
the drag move, the batch route). Both call `notifyStageEntered` **after**
`tx.immediate()` has returned, never inside it: minting does an LLM grounding
build and a comms round trip, and better-sqlite3 transactions are synchronous, so
an `await` between BEGIN and COMMIT would silently destroy the move's atomicity.
Scheduling goes through `afterResponse`, so the work is off the request's critical
path and survives on serverless.

**When it applies.** All three must hold, asked of *this workspace's* axis by role
rather than of a column named "Interview":

1. the entry now stands on a column with `role: "interview"`;
2. the hiring plan's step for that column exists and its **first round is
   `kind: "ai"`** (a human round is somebody else's job — a person books it on the
   Schedule tab's calendar);
3. no invite has already been dealt with for this (entry, stage).

**The gate.** `auto` → mint + dispatch now. `human` → hold: no link, no mail, no
spend; the entry is parked on the existing **`calendar`** approval, which *is* the
Schedule tab's AI-round docket — the candidate appears under "Awaiting link"
beside the button that calls the same mint door. No new approval kind was
introduced: the human surface for "this candidate is waiting for their interview
link" already existed and was already wired to the right action. The park is
CAS'd on `approval_kind IS NULL`, so an entry already waiting on a human
(a scorecard or offer review) never has its gate overwritten.

### The unsaved-gate asymmetry — read this before "fixing" it

The shipped default plan (`INTERVIEW_PLAN_DEFAULT`) gates its one AI interview
round as **`human`**, and the plan editor (`PipelineStepPolicy.tsx`) paints an
untouched step as `human` for the same reason. The product decision for this hook
is the opposite: *an AI step nobody has configured should run unattended.*

`effectiveInterviewGate` resolves it narrowly — an **explicitly saved** plan's gate
is honored exactly as saved, and only a workspace that has **never saved a hiring
plan at all** falls to `auto` for an AI round.
`getDecisionConfigVersion("interviewPlan", ws) === null` is the discriminator.

**Known inconsistency, deliberately left:** on a never-saved workspace the editor
*shows* "human" while the hook *acts* "auto". Closing it properly means changing
either the shipped default (a behaviour change for every existing install) or the
editor's unsaved paint — both decisions for the owner, not for this hook.

### Idempotence — at most one link per (entry, stage)

Entering the same column twice, a retried poll and a bulk move that touches the
same row twice all resolve to the same pair and are caught by two reads, which
cover different races:

- **the event half** — a `interview_invite_sent` row in `pipeline_events` whose
  `to_stage` is this stage. That row is written by `dispatchInterviewInvite`, so
  it is the *same* row the board's Create-link button and the Schedule docket
  write: a recruiter who already handed out the link while the candidate stood
  here never gets a second one mailed over the top of it;
- **the session half** — any interview session for the entry that is not
  `revoked`. This catches what the event cannot: a link minted moments ago whose
  dispatch has not recorded yet. A *revoked* session does not block — the
  recruiter pulled that credential, and a later arrival may legitimately mint a
  fresh one.

Beneath both, `mintAndInviteVoiceScreen` still revokes-then-creates, so even a
defeated guard yields one live link rather than two.

### Best-effort, and it fails towards the human

A failure to mint or dispatch **never fails the stage move** — the move has
already committed. When the hook cannot act (no deliverable contact address, an
exhausted `interview_minutes` allowance, a call already in progress, an
unexpected error) it *fails open towards the human*: nothing is minted, nothing is
sent, nothing anywhere claims an invite went out, and the candidate is left on the
`calendar` gate exactly where a `human`-gated step would have left them — visible
in the AI-round docket under "Awaiting link". The reason goes to the server log
(`[stage-hooks] <entry>: AI interview link not minted (<reason>) — <why>`).

The unaddressable check runs **before** the mint, not after: minting burns an LLM
grounding build and reserves voice minutes for a link nobody can receive. It uses
`isDeliverableAddress(candidateRecipient(entry))`, the same predicate the comms
layer itself uses, so "unaddressable" means here exactly what it means in the
Outbox.

The automatic path reserves budget exactly as the manual one does: the cheap
`interview_minutes` pre-gate before the grounded build, then the authoritative
`maxBillableInterviewMin(bookedMin)` reservation inside the shared door. It never
passes `force`, so a candidate mid-call can never have their session revoked and a
second invite mailed over the top of it by an automatic move.

**Known gap.** The hook emits **no event kinds of its own**. The event vocabulary
is pinned by set equality across three registries — `app/_lib/decision-attribution.ts`,
the feed's `app/features/hiring/pipeline/pipelineEventCatalog.ts`, and a localized
label per kind in all four catalogs — and a kind present in one but not the others
is a red build or an UNKNOWN badge in the candidate's history. So the *sent* case
rides the dispatcher's existing `interview_invite_sent` row and the *held* and
*failed* cases are visible as state (the `calendar` gate) plus a server log line,
rather than as timeline rows. Turning held/failed into first-class timeline rows
(`interview_invite_held` / `interview_invite_failed`) is a good follow-up and needs
all three registries updated in one change.

Tests: `app/_lib/stage-hooks.test.ts`.

## Link lifecycle

The candidate link is a capability — a 192-bit token, auto-emailed on create —
so its lifetime is enforced server-side in `app/_lib/db/interviews.ts` and read
by both the portal page and `/api/interview/connect`:

- **Expiry.** `isInterviewLinkExpired()` is the single authority:
  `INTERVIEW_LINK_TTL_DAYS = 7` measured **from creation**, applied to every
  non-terminal status (`created`, `in_progress`, `failed`). The one exception is
  a call that is live *right now* (`isInterviewSessionLive`, a 30-minute
  `updated_at` recency window) — a mid-conversation reconnect on a link that
  ages past the TTL during the call is never cut off. The TTL used to apply to
  `created` only, which meant one click on Start made the emailed credential
  permanent: an abandoned session still minted billable provider minutes months
  later. `/api/interview/complete` deliberately does **not** consult expiry —
  the transcript of a call that happened is always persisted.
- **Revoke / reissue.** `revokeInterviewSession` / `revokeOpenInterviewSessions`
  move `created|in_progress|failed` → `revoked` (never `completed` — the
  transcript is evidence). `/api/interview/create` revokes an entry's open links
  before minting a new one, so exactly one link is live per entry, and refuses
  (409) while a call is live unless `force: true`.
  A revoke cannot hang up a call that is already **in flight** — the browser
  holds a direct provider connection — so the candidate's hang-up still POSTs to
  `/api/interview/complete`. That finalize keeps the row `revoked`: the
  transcript is persisted (what was said is evidence), while the three
  `status === "completed"` side effects — the `interview_minutes` debit + cost
  ledger row, the synthesized scorecard, and the sealed `ai_scorecard` decision
  — are all skipped, and the link stays dead for `/connect`. Downgrading to
  `failed` instead would be wrong: `failed` is reconnectable by design and would
  hand a revoked credential back to the candidate.
- **One live call per link.** The token *is* the session, so two browser tabs on
  the same invite (or a forwarded link, or a reload racing the call it reloads)
  both used to reach `/connect`, mint their own provider credentials and run two
  real conversations for one screen — and at hang-up the second to finish was
  answered `{ok: true, alreadyCompleted: true}`, its transcript discarded behind
  a saved confirmation. `/connect` now refuses a second dial on a live session
  with `INTERVIEW_ALREADY_LIVE` (409) plus `retryAfterMin` as data. The portal
  page paints the same fact as a busy card (no Start) when
  `interviewPortalView` reads live, so a second window never mounts the client.
  The window is
  `isInterviewSessionLive` — `LIVE_INTERVIEW_RECENCY_MIN = 30`, the **same**
  authority `/create`'s reissue guard uses, so a link can never be at once too
  live to reissue and free to re-dial. A genuinely dropped call does not wait the
  grace out: every teardown path (hang-up, ICE drop, tab close via the unmount
  beacon) POSTs `/complete`, which finalizes a non-substantive call `failed` —
  reconnectable by design and no longer `in_progress`.
- **Terminal.** `completed` is single-use: the portal shows the thank-you card
  (with the durable `/status/<token>` link) and `/connect` refuses with 409, both
  backed by the `status != 'completed'` compare-and-swap in
  `markInterviewStarted` / `completeInterviewSession`. `failed` stays
  reconnectable by design — within the TTL.
- **Erased transcripts.** GDPR erasure (`scrubEntryLinkedPii`) rewrites
  `transcript_json` to `'[]'` in place and leaves the row `completed`. Both
  transcript-presence reads (`interviewStatusByEntries` per entry,
  `listRecentInterviewSessions` for the Schedule tab's AI-round docket) therefore
  test `IS NOT NULL AND != '[]'`, so an erased interview reads as **absent**
  everywhere instead of offering a review card with nothing behind it.

## Reachable from the assignment (`submissionId`)

`POST /api/interview/create` used to take a pipeline `entryId` and nothing else, and
`buildGroundedInterview` reads the whole brief off that entry. That is still true — a
voice screen is always attached to a board entry — but it made the screen unreachable
from the surface that most wants it. The reviewer reading a work-sample evaluation
(Assignments → the submission's eval panel) holds a **submission** id and has never held
an entry id, so a candidate who did the assignment was interviewable only after somebody
remembered to promote them first. The transcript and scorecard landed on the entry while
the evaluation lived on the submission: two evidence bundles about one person, with no
path between them a UI could act on.

The create door now accepts **either** id:

```jsonc
POST /api/interview/create  { "entryId": "…" }        // the candidate modal, unchanged
POST /api/interview/create  { "submissionId": "…" }   // the assignment's eval surface
```

- `entryId` wins when both are sent. It is the more specific request, and resolving a
  submission can legitimately answer a *different* entry (the candidate applied to the
  opening directly and the promote backfilled that row), so silently overriding an
  explicit entry would be the surprising half.
- `submissionId` resolves through `app/_lib/devcase-interview-entry.ts`:
  an entry already links this submission → use it; **no entry yet → promote through the
  shared promote door** (`promoteSubmission`, at `activePromoteFloor()`) and use what it
  returns. This route mints **no identity of its own** — the promote's rules from the
  one-thread milestone (real `profiles` row, the JD's real job id, the person's own
  archetype, ambiguity mints rather than resolves) are the only way a dev-case candidate
  reaches the board, and a second path "just for the interview" would re-create exactly
  the minted identity that milestone removed. The same `screening_review` card with the
  same advance/hold verdict is written either way, so starting a screen from the
  assignment produces the identical audit trail as pressing Promote and then Create link.
  What it removes is the *ordering* requirement, which was never a product rule.
- The response echoes `entryId` and `promoted`, so the caller can say that issuing the
  link also put the candidate on the board rather than leaving it to be discovered there.
- Refusals: an unknown submission and **another team's** submission answer alike
  (404, `INTERVIEW_SUBMISSION_NOT_FOUND`) — a distinct refusal would confirm which
  submission ids exist on other tenants, and this door can write a stranger's name and
  contact onto the caller's board. An unevaluated submission is 400,
  `INTERVIEW_SUBMISSION_NOT_EVALUATED`: there is nothing to promote on, and the brief the
  screen would carry is built from the evaluation's own minted follow-ups.

**The reverse read** is `GET /api/interview/by-entry?submission=<id>` → `{ session,
entryId }`. It adds no column and no new session lookup: `pipeline_entries.dev_submission_id`
already points from the entry at the submission and `interview_sessions.entry_id` already
points from the session at the entry, so "the screen for this submission" is those two
existing links composed (`findEntryByDevSubmission`, `app/_lib/db/pipeline.ts` — column
first, legacy `ds-` candidate id second, workspace-scoped). A `dev_submission_id` on
`interview_sessions` would have been a *third* statement of one fact, free to disagree
with the other two the moment a promote backfills onto an entry the candidate already
had. A submission that was never promoted answers `{ session: null, entryId: null }` —
an honest empty answer, not a 404, because "this candidate has no voice screen" is
exactly what was asked. The same read-time consent gate as `?entry=` applies.

The recruiter-facing half is `DevVoiceScreenPanel` (`app/features/tools/devcases/`),
rendered under the eval panel for every evaluated submission: the screen's status, its
verdict and mean observed rating when a scorecard exists, and otherwise the **same**
`PipelineVoiceScreenPanel` the candidate modal uses, pointed at this submission. One
affordance, one endpoint, one set of semantics (billing gate, reissue guard, delivery
truth) — the revoke control stays entry-scoped and is therefore not rendered there.
Pinned in `app/_lib/devcase-interview-entry.test.ts`.

## The interview-prep writes ask the SEAT

Tenancy answers *which team’s rows*; it never answered *may this seat*. The four
interview-prep write verbs asked **nothing** — not even `requireOperator()` — so
authority came down to holding a session plus an entry id, and entry ids are not
secret. A read-only **viewer** could therefore save an interviewer’s checklist and
notes (`PUT /api/interview-prep`), merge questions into a prep pack (`POST`),
weave or unassign one (`PATCH`), and file the human scorecard
(`POST /api/interview-prep/scorecard`) whose recommendation sets the
`scorecard_review` approval that opens the Interview→Offer gate and seals a decision
record.

All four now run `requireCapabilityCoded("pipeline:write", requireCapability)` as
their FIRST statement — ahead of the entry check and the throttle, so a refused seat
neither spends rate-limit budget nor learns which entry ids exist. A viewer gets
`FORBIDDEN_CAPABILITY` (403) carrying `capability` as data; an unauthenticated caller
gets 401; open dev mode is unchanged (every caller folds to owner). The read `GET`
is untouched. Driven against the real handlers in
`app/api/write-capability-gate.test.ts`, and the two rows are deleted from the
`app/api/route-capability-coverage.test.ts` allowlist so the win is locked.

## Tenant scope — the entry-keyed doors

Three operator doors key on a **pipeline entry id and nothing else**: `POST
/api/interview/create` (the reissue guard + revoke-first + the brief build),
`POST /api/interview/revoke`, and `GET /api/interview/by-entry?entry=`. Entry ids
are globally unique and not secret — several recruiter surfaces echo them — so
until the store functions beneath took a workspace, an operator on one team
holding a stranger's entry id could revoke another team's live interview link
mid-call, read their candidate's verbatim transcript and AI scorecard, and mint a
screen that emailed *their* candidate while `createInterviewSession` stamped the
session with the **stranger's** workspace and the minutes gate had checked the
caller's — gate and debit on two different tenants.

`revokeOpenInterviewSessions`, `latestInterviewByEntry` and `liveInterviewByEntry`
(`app/_lib/db/interviews.ts`) now take `workspaceId` in the defaulted-parameter
shape `route-tenancy-coverage.test.ts` derives, and scope their SQL on it. The
routes pass `await currentWorkspace()`; `buildGroundedInterview(entryId,
workspace)` therefore resolves nothing for a foreign entry and `/create` answers
the same **404** an unknown id gets. `/revoke` answers `{ ok: true, revoked: 0 }`
and `/by-entry` `{ session: null }` — deliberately the same shapes an
already-revoked / never-interviewed entry gets, because a distinct refusal would
confirm which entry ids exist on other tenants.

The `?entry=` read takes the **caller's** team, not `getEntryWorkspace(entry)`:
resolving the tenant from the row about to be returned scoped the consent lookup
to the stranger's tenant while still serving their transcript. Two callers outside
the request layer pass the entry's own team instead (`candidate-timeline.ts`,
`actOnPipelineEntry`'s reject-time revoke in `db/pipeline.ts`) — they already hold
the authoritative entry. Pinned by
`app/api/interview/interview-entry-tenancy.test.ts` (behavioural for the store
predicate, source-level for the route contract).

## Surface

| Path | Role |
|---|---|
| `app/api/interview/connect/route.ts` | Mints provider credentials + brief override |
| `app/api/interview/create/route.ts` | Creates a real candidate session, from an `entryId` **or** a dev-case `submissionId` |
| `app/api/interview/complete/route.ts` | Persists transcript, status, usage, scorecard |
| `app/api/interview/simulate/route.ts` + `attach/route.ts` | Recruiter demo/simulation sessions. `attach` reads the session **scoped to the caller's workspace** and keys its `sim_attached` annotation on `simAttachDetail()` (`attach/sim-session.ts`), which folds an opaque per-session ref into the drawer line — so the store's detail-keyed dedup is idempotent per (session, entry): a repeat POST answers the same `attachRef` and writes nothing, while a genuinely different practice run is no longer swallowed as a duplicate |
| `app/api/interview/revoke/route.ts`, `by-entry/route.ts`, `compare/route.ts` | Session management + cross-interview compare; `by-entry` also answers `?submission=` (the assignment-side reverse read) |
| `app/_lib/devcase-interview-entry.ts` | Resolves (or promote-then-resolves) the pipeline entry a dev-case submission's screen hangs off |
| `app/api/interview-prep/route.ts`, `.../scorecard/route.ts` | Prep chronology + scorecard read APIs |
| `app/_lib/voice/index.ts` | Adapter registry, default-provider policy, candidate-safe default brief |
| `app/_lib/voice/elevenlabs.ts`, `openai.ts` | The two provider adapters |
| `app/_lib/voice/self-hosted.ts` | Self-hosted ElevenLabs-compatible endpoint detection (see below) |
| `app/_lib/voice/connect-failover.ts`, `preflight.ts` | Provider failover + pre-connect capability checks (only a **connect** triggers a failover — a failing prompt build surfaces as itself, never as a second mint on the other provider). Pre-flight names the environment as a code (`VOICE_PREFLIGHT_INSECURE` / `_NO_MEDIA` / `_NO_WEBRTC`), resolved through `useErrorMessage` in the candidate's language — never a hardcoded English sentence |
| `app/_lib/voice/candidate-brief.ts` | The client-sent ElevenLabs brief's security boundary: allow-list sanitizers + `candidateSafeTopic` |
| `app/_lib/voice/minute-prices.ts` | Per-minute cost estimates for the usage ledger |
| `app/_lib/voice/asr-keywords.mjs` | The recognizer keyword bias — the account-wide floor list and the per-conversation builder (job terms first, capped at 50); shared with `scripts/setup-eleven-agent.mjs` |
| `app/_lib/interview-run.ts` | `buildGroundedInterview` (interviewer brief + the stored candidate agenda, composed clean via `candidateRunOfShow`), `buildCandidateSafeBrief`, `runInterviewScorecard` |
| `app/_lib/interview-scorecard.ts`, `interview-telemetry.ts`, `interview-transcript.ts` | Post-call scoring + telemetry |
| `app/_lib/interview-rubric.ts` | The scorecard rubric resolved from `pipeline/jobfit/interview-rubrics.json` (base axes by scoring model + industry axes by role family), its version hash, and `rubricCoverage` (below) |
| `app/_lib/interview-prep-run.ts` | Builds the prep pack (run-of-show + checklist) and stamps its provenance |
| `app/_components/RubricCoverageNote.tsx` | The shared rubric-coverage disclosure, rendered by the prep pack header and the human scorecard form |
| `app/_lib/interview-reminders.ts`, `interview-reminder-policy.ts` | Scheduling reminders |
| `app/_components/voice/VoiceInterview.tsx` | The live-call shell — phase, consent, finalize/beacon, and the call controls. A `/connect` 409/403 paints `errors.<CODE>` (and `retryAfterMinutes` for `INTERVIEW_ALREADY_LIVE`) instead of the generic start failure |
| `app/_components/voice/transport/openai.ts` | OpenAI Realtime over raw WebRTC: connection setup, the H3 speaking meter, the H4 drop debounce, teardown, and the transcript-buffer half of the wire protocol |
| `app/_components/voice/transport/elevenlabs.ts` | The `@elevenlabs/react` SDK path: `useConversation` wiring and the agent prompt/language + `asr.keywords` overrides |
| `app/_components/voice/availability-gate.ts` | The portal's start gate. The `/api/interview/connect` probe has THREE outcomes — `loading` / `ok` / `failed` — and `voiceStartGate` maps them to `checking` / `available` / `unavailable` / `unknown`. A **failed** probe used to be stored as `null`, the same value as "not asked yet", and the render read that as available: a keyless or unreachable server therefore rendered a normal Start that died at connect, while the `unavailableCandidate` copy written for that moment was unreachable. `unknown` now renders "we could not check" plus a **Check again** control and never a plain Start |
| `app/_components/voice/timer-registry.ts` | Every delayed callback one call schedules — the 30 s connect timeout, the ElevenLabs disconnect-grace fallback, the finalize poll — in one registry the unmount effect empties. Two of the three were untracked `setTimeout`s that survived unmount and were harmless only because `finalizedRef` latches first. `sleep()` resolves on `clearAll()`, so a tab closed mid-hang-up unwinds the finalize path instead of leaking it. `set()` returns a cancel for ONE timer, and that is how the live call retires its connect timeout — `clearAll()` is the unmount teardown and leaves the registry inert, and using it as "clear the connect timer" meant the 30 s timeout was never armed, the ElevenLabs end fallback never fired and the closing-answer grace became a busy-loop that starved the data channel it waited on. Each mount installs a fresh registry, so dev StrictMode's remount does not inherit a dead one |
| `app/features/tools/interview/simBilling.ts` | What a simulation costs: `simBillableCeilingMin(mode)`, quoted by `InterviewStartPanel` before the recruiter starts. Mirrors `maxBillableInterviewMin` (the client cannot import `billing/enforce.ts` — it reaches better-sqlite3), and `simBilling.test.ts` imports both and asserts the same number mode by mode |
| `app/_components/voice/useTranscriptPersistence.ts` | POST-with-retries to `/api/interview/complete`, the sessionStorage stash, and the online/visibility re-drive |
| `app/_components/voice/useMicTest.ts` | The pre-call mic test (stream, analyser, level, verdict). `micTestFailure` routes every `getUserMedia` rejection through `micErrorText`, so **not-found** and **busy** are no longer both reported as "denied"; `MIC_TEST_DURATION_MS` / `MIC_HEARD_RMS` name what were inline literals |
| `app/_components/voice/transport/transport-error.ts` | `VoiceTransportError` + the status/throw classifier. Four client-origin codes (`VOICE_TRANSPORT_NETWORK` / `_AUTH` / `_TIMEOUT` / `_PROVIDER`) resolved through `errors.<CODE>`; the provider's response body goes to the console, never to the candidate |
| `app/_components/voice/transcript-follow.ts` | `shouldFollow` (autoscroll only while the reader is at the tail), `foldTranscript` + `turnKey` (a bounded live log with full-transcript-stable keys) |
| `app/_components/voice/micErrorText.ts` | getUserMedia failure → actionable recovery copy |
| `app/_components/voice/VoiceSettings.tsx` (the provider picker consumes the same `availability-gate` the Start button does — an unchecked provider is disabled, with the same **Check again** line), `MicTestPanel.tsx`, `VoiceLiveControls.tsx`, `VoiceStatusPill.tsx`, `VoiceTranscript.tsx` | The view's leaf components (lab-only pickers, mic-test panel, live-call controls, status pill, transcript log). The live clock is elapsed-only in the lab; the portal passes the grounded `durationMin` so `live-clock.ts` shows remaining (`durationMin*60 - elapsed`, clamped at 0) beside elapsed |

## Data model

- Interview sessions (token, provider, mode, status) — `app/_lib/db` (`createInterviewSession`, `getInterviewSessionByToken`, etc.)
- Transcript + scorecard rows, linked to a pipeline entry when candidate-mode
- `llm_usage` ledger rows for voice minutes (`interview_realtime` use case)
- `interview_preps` — one prep artifact per pipeline entry (`app/_lib/interview-prep.ts`).
  Its `created_at` is the **generation** stamp, not a last-modified stamp: it is what
  the modal/schedule card render as "generated NN ago" and what `isPrepStale` compares
  against the linked JD's last content edit (`jdLastEditedAt`) to raise the "JD edited
  since" chip. Only a real rebuild moves it — `saveInterviewPrep(..., { regenerated: true })`,
  passed by `runInterviewPrep` alone. The other writers round-trip the same plan through
  that upsert (the interview-kit import `POST`, the weave/unweave `PATCH`, and the
  checklist/notes `PUT` via `saveInterviewPrepProgress`) and deliberately leave the stamp
  where it was; bumping it there would mark a pack fresh while its chronology still
  described the old role.

## Rubric coverage — when the scorecard is generic, it says so

A resolved rubric is the archetype's base axes (`experienced` or `early_career`)
plus the **industry axes** for the entry's role family — clinical judgment,
safety, scientific rigor, and so on. `pipeline/jobfit/interview-rubrics.json`
defines `industryAxes` for exactly **6** of the **16** canonical role families
(`data/taxonomy.json` → `role_families`), all from the care/trades/frontline arc.
`industryAxesFor()` returns `[]` for an absent family, for one of the other ten,
and for an unrecognized string alike, and that empty list concatenates into the
rubric leaving no trace.

`rubricCoverage(roleFamily)` (`app/_lib/interview-rubric.ts`) reports the
distinction the empty array erased, as `{ gap, roleFamily, axisKeys }` — and it is
**three** cases, because only two of them are problems:

| `gap` | Meaning | How it surfaces |
|---|---|---|
| `null` | Industry axes applied; `axisKeys` lists them | Nothing rendered |
| `no_family` | The entry has **no** role family, so which axes apply is unknowable | Amber notice (`role="status"`) |
| `family_no_axes` | A canonical family with no axes defined — the designed state for 10 of 16 | **Nothing rendered** |
| `family_unrecognized` | The family string is not in the canonical taxonomy at all — a data anomaly | Quiet factual line naming the value |

`family_no_axes` is silent on purpose. For `software_engineering`, `data_ai`,
`finance_accounting`, `legal_compliance` and the rest of that cohort the base
rubric is not a degraded fallback — it **is** the intended rubric. Disclosing it
would fire on the majority of interviews and turn the notice into wallpaper,
training recruiters to ignore it on `no_family`, where it genuinely matters. The
silence is structural, not a UI branch: `RUBRIC_COVERAGE_DISCLOSED_GAPS` drives
both the component's `isDisclosedGap` gate and the message catalog, so a silent
gap has no string it could render.

### The rubric and the prep pack in four languages

The rubric's **display** strings (competency labels, descriptions, the BARS
anchors, the 1–5 scale) live in the `rubric` message namespace; the canonical
English `competency` stays the scoring/storage key that every POST carries, so
localizing display cannot touch the scoring contract. `interview-rubric.ts` keeps
only the pure resolution (`localizedRubric`, `rubricLabel`, `rubricAnchorLine`,
…), taking a catalog lookup that client components build with
`useRubricStrings()`; an axis with no catalog entry — an LLM-emitted competency
outside the fixed rubric — degrades to its canonical name, and a half-translated
BARS ladder falls back whole rather than mixing languages.
`interview-rubric-catalog.test.ts` pins every locale to exactly the competencies
`interview-rubrics.json` defines, and pins the English catalog to the JSON
verbatim so the duplicate never becomes a second source of truth.

The **prep pack** sits on the other side of that line: it is generated in a
detached task that cannot read the request cookie, so the recruiter's locale
rides in on the task params and is stamped on the stored payload (`lang`).
`buildRunOfShow` / `studentPrepRunOfShow` stay pure and receive their copy as a
parameter from `interview-prep-strings.ts`, which loads
`scheduleTab.prep.plan` / `.studentPlan` through the locale-pinned translator —
see [`docs/architecture/localization.md`](../../architecture/localization.md).
Both surfaces previously carried en+cs tables, so a German or French recruiter
read English with no signal that anything was missing.

The same rule reaches the **candidate's** side of the brief. Three things a
candidate reads or hears were hard-coded English literals regardless of
`pipeline_entries.locale`:

- the **submission-debrief agenda** — the four-item run-of-show persisted on
  `interview_sessions.run_of_show_json` by `POST /api/interview/create` and
  rendered by the portal's `InterviewSidebar`;
- the **"Recruiter-added questions"** topic the imported interview-kit questions
  are injected under in the candidate-safe voice brief
  (`buildCandidateSafeBrief`), which the agent narrates aloud; and
- the **opening-language instruction**, which mapped `cs → Czech` and everything
  else → English, so a German or French applicant's interviewer was told to open
  in the one language they had just declined at apply.

The first two now come from `interviewBriefStrings(entry.locale)` in
`interview-prep-strings.ts` — the same locale-pinned catalog loader as the prep
pack, reading the `interview.brief` namespace in all four catalogs. The third is
`OPENING_LANGUAGE_NAMES` in `interview-run.ts`, a `Record<Locale, string>` so a
new locale is a tsc error rather than a silent fallback to English. A preferred
locale **replaces** the shared Czech+English greet-then-detect paragraph
(`PERSONA_LANGUAGE_DETECT`) rather than appending after it: that paragraph used
to say it outranked every other instruction, so a German or French applicant
still heard a CS+EN opener. A null locale keeps the bilingual greet
byte-identical (the Python eval port's default student brief stays in lockstep).
Because the topics now load a catalog, `buildCandidateSafeBrief` is **async**;
the connect route resolves it once before `connectWithFailover` (whose
`resolveAgentPrompt` is synchronous by contract, so a failover never awaits
between attempts). `interview-run-locale.test.ts` pins all of it against a real
entry: a `de` entry stores a German agenda, an absent or unsupported locale
keeps English, a `de`/`fr` brief opens in that language with no CS+EN greet, and
the opening-language table is checked for parity with `LOCALES`.

The disclosure renders in **both** places a recruiter meets the rubric — the prep
pack header (`ScheduleInterviewPrepHeader`) and the human scorecard form
(`ScheduleHumanScorecardForm`) — through one component,
`app/_components/RubricCoverageNote.tsx`, translated in all four locales under the
`rubricCoverage` message namespace. The `gap` is **persisted for all three cases**
— on the prep payload (a generator-owned key, `interview-prep-run.ts`), on the
stored human `Scorecard` beside `rubricVersion`/`rubricKeys`, and on the
AI-synthesized scorecard after `runInterviewScorecard`'s post-pass — so the
record stays complete even where the UI stays quiet.

`rubricCoverage` is a pure *report*: it never infers or defaults a role family,
and it leaves `rubricForArchetype()` output byte-identical (pinned by the
`REGRESSION:` case in `app/_lib/interview-rubric.test.ts`, which re-checks every
archetype × family combination's version hash). Guards:

- `app/_lib/role-families.test.ts` — pins `ROLE_FAMILY_SLUGS` (the canonical set
  `rubricCoverage` tests membership against) by set equality to
  `data/taxonomy.json::role_families`, the same file `pipeline/jobfit/taxonomy.py`
  reads. The TS mirror previously had no guard at all while the Python half did.
- `app/_lib/interview-rubric.test.ts` — asserts the 6 / 10 / 16 cohort shape and
  that each cohort lands in the right case, so the partition cannot silently invert.
- `app/_components/rubric-coverage-catalog.test.ts` — pins the message catalog to
  `RUBRIC_COVERAGE_DISCLOSED_GAPS`, and asserts the silent gap has **no** key.

The AI-synthesized scorecard gets the same stamp in TypeScript after the Python
spawn (`runInterviewScorecard` → `stampAiScorecardRubricCoverage`), so a recruiter
comparing two AI screens can see when one was scored without industry axes. Python
still does not write the field; the post-pass will not overwrite it if that
changes. The field stays optional for legacy rows.

## The scorecard fences the transcript and cites only what was said (scorecard-v7)

The scorecard prompt is the one in this package whose main input is written by the
person it rates, and whose output opens the Interview→Offer gate. Four things were
true of it before `scorecard-v7` and are not any more.

**The transcript was unfenced.** It went into the prompt in bare triple quotes, so a
candidate who spoke a triple-quote plus an instruction closed the quoting and the
rest of their sentence read to the model as scoring instructions. It now enters
through `fenced_untrusted("INTERVIEW_TRANSCRIPT", …)`
(`pipeline/jobfit/devcase/provenance.py`) — the same fence the group-compare
candidate block and the devcase prompts use. `json.dumps` inside the fence escapes
the newlines a forged marker needs, and the fence's standing rule tells the model
the block is evidence, never orders. Bound to the real prompt (not to the helper) by
`pipeline/jobfit/tests/test_prompt_fences.py::_JSON_FENCE_SITES`, which proves each
site non-vacuous by neutralising the fence and requiring the same assertion to fail.

**The model's answer was pinned too loosely.** `_generate` pins the parse with
`expected_keys` so an object echoed *after* the answer cannot win it (`_extract_json`
otherwise takes the last value). The default is the deterministic template's own
keys, and the match is ANY key — so a trailing `{"recommendation": "reject"}`
satisfied it and flipped the verdict. `interview_scorecard` now passes
`expected_keys=("ratings",)`: the one key a real scorecard always carries and a
one-line verdict object never does.

**Nothing checked that a quote was real.** The prompt asks for a "short,
near-verbatim quote of the candidate's own words" and the only downstream guard
(`isPlaceholderEvidence`, TS) knows the boilerplate, not invention — so a fabricated
line reached the recruiter looking exactly like a real one. `ground_scorecard_evidence`
now normalizes each quote (case, punctuation, whitespace — the axes near-verbatim
drifts on) and requires it to occur in the transcript **the model was shown** (the
head+tail `sample_scorecard_notes` sample, not the full stored transcript: a quote
from an elided middle turn is one the model could not have read). A quote that does
not occur is replaced with `UNGROUNDED_EVIDENCE`, which carries the cross-language
`"Not assessed…"` prefix contract — so every surface that already filters the
placeholder out of its quote list (`ScheduleInterviewScorecardRow`,
`JobsCompareInterviewsEvidenceCard`) stops rendering it as a candidate quote with no
read-side change. The rating itself is kept: this drops the *citation*, not the
score. The count rides as `ungroundedEvidence` and the confidence band's **reason**
names it, so "the interview was short" and "the model quoted lines that are not
there" stop widening the band identically.

**The prose never said which language it was in.** The summary and the
recommendation rationale follow `language_directive(lang)` on the LLM path, but the
deterministic template is English whatever was asked for — so a cs/de/fr session
stored English prose inside localized chrome with nothing saying so, unlike every
sibling narrative. The scorecard now stamps `narrativeLang`
(`match_reasoning.narrative_lang_for`, the same helper `reasoning_cli` and
`group_compare_cli` use) and `ScheduleInterviewAiScorecardSection` renders the honest
note exactly as `MatchReasoningPanel` does for the match rationale.

Additionally, the scoring instructions now carry the **same fairness clause the
interviewer brief carries** (`pipeline/jobfit/eval/interview_eval.py::NON_NEGOTIABLES`):
never lower a rating for nerves, hesitation, filler, silence or imperfect
grammar/accent, and an honest "I don't know" is not a negative signal. The brief said
it to the agent *running* the call; nothing said it to the model producing the
*rating*, which is the half a hiring decision reads.

`SCORECARD_PROMPT_VERSION` / `AUTOMATION_VERSION.scorecard` moved to `scorecard-v7`
in lockstep (`test_prompt_version_sync.py`), so cached v6 scorecards self-invalidate.

**Known gap:** grounding is a containment test against the sampled transcript, so a
quote the model assembles from two separate turns fails it and is dropped as
ungrounded — conservative in the safe direction (a citation is lost, never invented).
The de/fr transcript detectors in the interview eval harness remain a follow-up.

## Spend doors, throttles and refusal codes

Four doors in this feature cost real money on an accepted call, and until this pass
only one of them was throttled. Two more — the prep artifact's write verbs — cost no
money but were the last unmetered writes on the surface, and are now bounded too.

| Door | Budget | Guards |
|---|---|---|
| `POST /api/interview/create` | 20 / 10 min per IP (`CREATE_RATE_LIMIT`) | A model-backed run-of-show build **and** an email to the candidate, per call |
| `POST /api/interview/simulate` | 20 / 10 min per IP (`SIMULATE_RATE_LIMIT`) | Mints a real billable session; on a self-hosted install it skips `meterGate`, so the limiter is the only bound |
| `POST /api/interview/connect` | 6 / 10 min per **token** (120 when a self-hosted provider serves) | The provider credential mint |
| `POST /api/interview/complete` | 10 / 10 min per **token + IP** (`COMPLETE_RATE_LIMIT`) | The transcript write, the `interview_minutes` debit and the LLM scorecard run + sealed decision |
| `PUT` / `POST` / `PATCH /api/interview-prep` | 600 / 10 min per IP, ONE shared bucket (`PREP_WRITE_RATE_LIMIT`) | Three read-merge-writes against the same prep artifact |
| `POST /api/interview-prep/scorecard` | 60 / 10 min per IP (`SCORECARD_RATE_LIMIT`) | The recruiter's verdict write, which on a recorded recommendation for an active **interview-role** column (not the literal name `Interview`) also sets the `scorecard_review` approval, records an automation event and seals a decision |

The prep budget looks loose next to its neighbours and the reason is pinned in
`rate-limit-contract.test.ts` so nobody tightens it into a bug: the interviewer's
checklist/notes `PUT` is debounced at 600 ms and fires all through a live interview,
and with `KP_TRUSTED_PROXY` unset `clientIpFrom` collapses the whole deployment into
one bucket — so a tight ceiling would throttle the interviewer the door exists for,
and every colleague beside them, mid-call. It still caps a script at one write a
second. The scorecard door is tighter because one save per interview (plus an edit or
two) is the honest shape. On both, the "you did not say which candidate" 400 is served
BEFORE the limiter: a request that was never going to write must not spend the window.

**Every refusal on these five verbs is now a code, not a sentence.**
`INTERVIEW_ENTRY_REQUIRED` (400), `INTERVIEW_PREP_QUESTIONS_REQUIRED` (400, an empty
import), `INTERVIEW_PREP_QUESTION_REQUIRED` (400, a weave with no question),
`INTERVIEW_PREP_NOT_FOUND` (404) and `TOO_MANY_REQUESTS` (429). The 404 is deliberately
ONE code for "never generated" and "belongs to another team" — indistinguishable to a
caller who does not hold the entry, which is the tenancy property those routes were
built around. `ScheduleHumanScorecardPanel` already resolves through
`useErrorMessage`, so the recruiter now reads the refusal in their own language
instead of the server's English.

Three English constants used to shadow this contract — `CONSENT_REQUIRED_ERROR` and
`CONSENT_NOT_RECORDED_ERROR` in `interview-consent.ts`, `INTERVIEW_LAB_DISABLED_ERROR`
in `interview-lab.ts`. Their doc-comments claimed the routes shared them; grep says no
route had read any of them since the refusals moved onto `jsonRefusal`, and all three
are gone. Those two modules are the PREDICATE and the GATE; the wording is the
catalog's. `interview-lab.test.ts` now pins the gate itself — production closed by
default, open only on the exact `INTERVIEW_LAB_ENABLED=1` opt-in (not "true", not
`0`), read per call rather than captured at import, and actually consulted by
`/connect` before it mints. The lab page's disabled-state and enabled-state copy
(`interview.lab.disabledBody`, `enabledBody`, `candidatePortalNote`,
`diagramsLink`) comes from `interview.lab.*` in all four catalogs.

The candidate sidebar's duration chip was the other English leak: `durationChip` /
`durationLabel` composed "~20 min" / "About 20 minutes" inside
`interview-duration.mjs` and `InterviewSidebar` painted the chip verbatim beside an
agenda next-intl had already localized. Both helpers are deleted; the chip resolves
`interview.sidebar.durationChip` (`{min}` interpolated), and
`interview-duration.test.ts` asserts every export of that module is a number, so a
phrase cannot come back. `debriefDurationMin` — the arithmetic behind both the
candidate brief's promise and the minted calendar link — is pinned by
`interview-planned-minutes.test.ts`: the documented 8 + 3-per-question shape,
monotonic, above the quick-screen floor and capped inside the grounded band.

The **operator-side** telemetry strips leaked the same way, one layer down and in three
places at once. `formatSpokenDuration` (`app/_lib/voice/telemetry-format.ts`) returned the
finished string `"12m 30s"`, and `PipelineInterviewTelemetryStrip`,
`ScheduleInterviewTelemetryStrip` and `JobsCompareInterviewsCohortTable` painted it verbatim
beside labels next-intl had localized — so a Czech, German or French recruiter read an
English unit on the longest-pause and spoken-duration signals. The projection now returns
PARTS (`{ m, s }`) and each strip renders `t("duration", parts)`; the ICU message in all four
catalogs picks the minutes-and-seconds / minutes-only / seconds-only shape in the reader's
language (`scheduleTab.transcript.duration`, `jobs.compare.duration`). The unit letters
cannot come back: `telemetry-format.test.ts` reads its own module and fails on any spliced
unit or bare `"m"`/`"s"` literal, the same shape as the `interview-duration.test.ts` guard
above.

`/complete` is the odd one out and the reason its budget is keyed on **both**: it is a
PUBLIC token route (`public-routes.ts`), so there is no operator gate to be a no-op —
the token in the URL is the whole credential. Keying on the token alone would let one
candidate's flaky network exhaust their own budget on legitimate retries; keying on the
IP alone would throttle a whole NAT of candidates together. Its cheap refusals (400 /
404 / 403 consent, and the idempotent `alreadyCompleted` reply that lets a retrying
client settle) all run BEFORE the limiter and stay free forever. On the client,
`useTranscriptPersistence` treats 429 as transient — the one 4xx that will improve on
retry — so a throttled replay keeps its `sessionStorage` stash instead of discarding
the candidate's transcript.

Every route here is operator-gated, and open mode (`KP_OPERATOR_PASSWORD` unset) makes
that gate a documented no-op for the whole API — so the limiter is the real bound, the
same reasoning `app/api/rate-limit-contract.test.ts` already records for the JD
library's four spend doors. All three are pinned there: key, budget, window, the
expensive work each must precede, and the cheap refusal each must follow.

`/create`'s five decisions run in a fixed order, and the order is the contract: the
cheap 402 pre-gate and the "no candidate named" 400 serve free → the throttle →
`buildGroundedInterview` (whose booked length sizes the next step) → the
**authoritative** reservation of `maxBillableInterviewMin(bookedMin)` → the reissue
revoke → the mint. The reservation before the revoke is load-bearing: refusing after
killing the candidate's live link is the worst of both. Pinned by
`app/api/interview/interview-spend-doors.test.ts`.

### The minted credential is bounded and bound

The ephemeral secret `/connect` hands the browser is the one artifact in this
flow that can spend money at the provider on its own — a leaked one dials
`/v1/realtime/calls` with no involvement from this server, and only the per-token
connect throttle stood in its way. It now carries:

- **A lifetime we state.** The OpenAI mint sends `expires_after`
  (`OPENAI_SECRET_TTL_SEC = 120` — one dial, not a workday) instead of inheriting
  the provider default, and the returned `expires_at` is **enforced**: absent,
  malformed or already past is refused before the secret reaches the browser. It
  had been parsed into the response type and read by nobody, so an expired
  credential failed later at the SDP exchange, where it is indistinguishable from
  a network fault.
- **A binding to one session.** A truncated SHA-256 of the capability token rides
  in the provider session's `metadata` (`interviewSessionFingerprint`) — a
  fingerprint, never the token, which opens the whole interview and never leaves
  this server. A provider that rejects the field gets exactly one retry without
  it: an audit convenience must not fail a candidate's interview.
- **Timeouts on every hop.** Both provider mints (15 s) and the browser's SDP
  POST (12 s) carry an `AbortSignal.timeout`, all inside the client's 30 s
  connect latch. Unbounded, a wedged provider — or a wedged *self-hosted* voice
  service — held a route open on a session already flipped `in_progress`, and the
  SDP fetch outlived the error card the candidate was already reading. An aborted
  SDP POST classifies as `VOICE_TRANSPORT_TIMEOUT`, already localized.

### Refusals answer with a code

Every refusal on `/create` and `/connect` now goes through `jsonRefusal` with an
`INTERVIEW_*` code from `REFUSAL_ERRORS`, so `useErrorMessage()` resolves
`errors.<CODE>` in the reader's language (four catalogs, pinned by
`npm run i18n:check`). `/connect` mattered most: it is a **public** surface opened
from an invite deliberately rendered in the applicant's own language (`?lang=`), and
it answered five different lifecycle refusals — not found, revoked, expired, already
completed, consent missing — in hardcoded English.

`INTERVIEW_ENTRY_REQUIRED`, `INTERVIEW_SUBMISSION_NOT_FOUND`,
`INTERVIEW_SUBMISSION_NOT_EVALUATED`, `INTERVIEW_CALL_IN_PROGRESS`,
`INTERVIEW_LINK_NOT_FOUND`, `INTERVIEW_LINK_INACTIVE`, `INTERVIEW_LINK_EXPIRED`,
`INTERVIEW_ALREADY_COMPLETED`, `INTERVIEW_CONSENT_REQUIRED`,
`INTERVIEW_PROVIDER_INVALID`, `INTERVIEW_PROVIDER_UNCONFIGURED`,
`INTERVIEW_LAB_DISABLED`, `INTERVIEW_ALREADY_LIVE`, plus the shared
`TOO_MANY_REQUESTS` and `PIPELINE_ENTRY_NOT_FOUND`. Diagnostic detail rides **alongside** the code rather
than inside a sentence: the unconfigured 503 still names the missing env vars in
`need`, where an operator can read them and a candidate never sees them.

`/api/interview/complete` is now held to the same line. It is the **same
candidate**, one hang-up later, and its last three refusals were still bare
English — `"token is required"`, `"session not found"`, and a hardcoded consent
sentence. They answer `INTERVIEW_LINK_NOT_FOUND` (both no-usable-session cases:
to the reader they are one fact) and `INTERVIEW_CONSENT_REQUIRED`.

### A discarded transcript is never reported as saved

Every "this session is already finished" branch on `/complete` answered
`{ok: true, alreadyCompleted: true}`. That is correct for the honest duplicate —
the End fetch racing its own unload beacon, a network retry, a `sessionStorage`
stash replayed on the next mount — and a retrying client has to settle rather
than error. It was a green lie for the loser of a two-tab race, whose own
conversation is nowhere in the stored record.

`discardedTurnCount` (`app/_lib/voice/discarded-turns.ts`) draws the line by
comparison, not by counting: a body the stored transcript already contains, in
order, from its first turn on, is the same call reporting twice and still settles
`200 {alreadyCompleted: true}`. Anything else — a divergence, or turns the record
does not have — is a different conversation, refused
`409 {ok: false, code: "INTERVIEW_ALREADY_COMPLETED", discardedTurns: n}` on both
the terminal guard and the lost compare-and-swap branch, with a server log naming
the session. The candidate reads `interview.voice.discardedTurns` in their own
language instead of the Retry banner, which could only ever be refused again, and
the stash is dropped so the discarded body is not re-POSTed on every mount.

The id narrowing behind all of it lives once, in `app/api/interview/entry-id.ts`
(`readEntityId`, `MAX_ID_LEN`) — four doors had re-typed the same "string, trimmed,
non-empty, ≤ 120 chars" clause inline.

### When the invite does not go out

`POST /api/interview/create` returns `delivery` (the truthful outbox claim:
`sent` / `queued` / `failed`) **and** `deliveryError`, a code saying *why* when it is
not `sent`:

- `INVITE_PROVIDER_UNCONFIGURED` — the provider has no keys on this server, so no
  invite was attempted at all;
- `INVITE_DISPATCH_FAILED` — the dispatch threw or dead-lettered.

The remedy is the same for both (the link is in the response; hand it over), but the
recruiter no longer has to guess which happened. Both are `errors.*` catalog keys in
all four locales.

### The candidate never reads the provider's words

Three failure paths in the live-call shell used to render an upstream string
straight into the candidate's error banner: the realtime transport threw
`OpenAI calls ${status}: ${body}` (the provider's response body, sliced to 200
chars), and the ElevenLabs SDK's own English `message` was shown both on
`onError` and on a failed `startSession`. All three now resolve a **code**:
`transport/transport-error.ts` classifies a failure as `VOICE_TRANSPORT_NETWORK`,
`_AUTH`, `_TIMEOUT` or `_PROVIDER` and the shell renders `errors.<CODE>` through
`useErrorMessage()`, in the reader's language. The real body still reaches the
operator — once, on `console.error`.

Those four codes are **client-origin**, so they deliberately do not appear in
`STORE_ERRORS` / `REFUSAL_ERRORS` (the vocabulary a route handler emits; a code
there that no handler can return would make the server contract lie). They are
pinned to all four catalogs by `transport-error.test.ts`, the client-side twin of
the registry check in `scripts/i18n-check.mjs`.

### A closing answer lost to the grace is in the record

When the OpenAI hang-up grace (`OAI_FINAL_TURN_GRACE_MS`) expires with a candidate
transcription still in flight and an empty delta buffer, that closing answer is
gone from the transcript the scorecard is built on. It used to be a
`console.warn` — invisible to the recruiter reading the scorecard. It is now
written **in band**, as a `system` turn (`interview.voice.closingTurnLostNote`),
which is the path `capTranscriptTurns` already uses for its "turns omitted"
marker: a system turn is persisted by `/api/interview/complete`, read by the
scorer (`transcriptToNotes` prefixes it `System:`) and rendered by the recruiter's
transcript modal (`ScheduleInterviewTranscriptTurns`). The console line stays for
the operator, with the env-var remedy.

### The live transcript keeps the reader's place

`VoiceTranscript` pinned itself to the newest turn on **every** append, so a
candidate who scrolled up to re-read the question they were answering was pulled
back mid-call. It now follows only while the reader is at the tail
(`shouldFollow`, measured from the reader's own scrolling), keys turns by their
position in the full append-only transcript rather than by index in the rendered
slice, and renders a bounded window (`MAX_VISIBLE_TURNS`) with a counted "earlier
turns" line above it. The full transcript is the persisted record; the live log is
a view of it.

### Two best-effort catches that now say what was lost

`/api/interview/complete` runs the usage-ledger write and the scorecard synthesis
after the transcript is durable, and both stay **best-effort** — neither may fail a
completion whose transcript is already saved. What changed is that neither is silent
any more, and the choice was a **log, not a status column**:

- the ledger row is the only record of what a call **cost** (the meter counts
  quantity, not money), so a dropped write logs the session id, the billed minutes
  and the provider;
- a failed synthesis is already visible as an absent scorecard — the drawer offers
  the transcript with no verdict and the Interview→Offer gate stays unapproved — so
  the missing half was the *reason*, which only a log can carry. No
  `scorecardStatus` column was added: it would state a fact the row already states.

## What a call cost reaches the recruiter

`/api/interview/complete` has written every completed call's cost to the usage
ledger since tiger F1 — `llm_usage.request_id` **is** the session id, use case
`interview_realtime`, provider + model + a duration-derived estimate from
`app/_lib/voice/minute-prices.ts` — whose figures are midpoints of **public price
bands, not contractual rates**, so an operator on a Business tier or a negotiated
contract sets `KP_VOICE_MINUTE_USD_OPENAI` / `KP_VOICE_MINUTE_USD_ELEVENLABS`
(USD per conversation minute, read at call time) and the ledger prices at what
they actually pay. A malformed or negative value is refused with a console
warning and the estimate stands; a self-hosted session stays $0 regardless.
Voice minutes are the one meter with a real
per-unit cost, and the two providers differ by roughly 60% per minute, yet that
number had **no reader** outside the aggregate Models usage panel: the recruiter
deciding whether to run another screen could not see what the last one cost.

`InterviewSessionSummary` now carries `costUsd`, read in the same query that builds
the AI-round docket (a correlated `SUM(cost_usd)` over `llm_usage` keyed by request
id **and** use case — no extra round trip, and the left side is already
workspace-scoped). The Schedule tab's AI ledger no longer lists completed calls
(2026-09), so the figure's reader is Insights → Activity: the `interview_realtime`
row carries the cost, and its detail opens the conversation.

The answer has **three** states and the third is the one that had no way to be said
before:

| `costUsd` | Means | Rendered |
|---|---|---|
| a number > 0 | The ledger priced this call | The amount, in the reader's locale |
| `0` | A **self-hosted** provider served it, so no per-minute credits were spent | "no per-minute cost" |
| `null` | Unknown: no ledger row yet (not completed), or an unpriced provider whose row carries `cost_usd` NULL by design | "cost unknown" |

Collapsing `null` to `0` would tell a recruiter the priciest meter in the product is
free. `app/api/interview/interview-session-cost.test.ts` pins all three states, the
use-case keying, the multi-attempt total, and that the join did not widen the
tenant scope of the list it rides on.

`interviewedForJob` — the cohort behind the side-by-side compare view
(`/api/interview/compare`) — carries the same `costUsd` on the same query shape, so
the compare table and the docket can never disagree about what a screen cost. The
compare grid itself lives in `app/features/library/jobs/` and does not render it yet.

### …and how the call actually ran

The same summary now also carries **`failoverFrom`** and **`attempts`**, backed by two
additive columns on `interview_sessions` (`failover_from TEXT`, `attempts INTEGER NOT
NULL DEFAULT 1`, migrated in the `app/_lib/db/core.ts` ALTER loop; no new table, so
`app/_lib/tenancy.ts` is unchanged — the columns inherit the row's existing
`workspace_id` scope).

| Field | Written by | Honest null / floor |
|---|---|---|
| `failoverFrom` | `/api/interview/connect` when `connectWithFailover` had to use the other provider — `setInterviewSessionProvider(id, served, requested)`, `COALESCE`d so the FIRST fallen-from provider (the one the recruiter chose) wins | `null` = nothing fell back. Never a copy of `provider` |
| `attempts` | `markInterviewStarted`, in the same guarded UPDATE: `+1` only when `started_at` is already set, so the first connect is the `1` the column defaults to and a refused connect on a completed session cannot inflate it | `1` for a link never opened and for the ordinary call. Never `0` |

Both facts already existed and were both thrown away. `provider` is **overwritten in
place** with whoever actually served (the completion ledger prices from it), so the
requested provider survived only as a `console.warn`: a recruiter looking at a call
billed on the other vendor had no way to learn that theirs was down. And
`/api/interview/complete` already reasons about "the current attempt" when it bills
(a `failed` session stays reconnectable by design, so the later of
`started_at`/`updated_at` is when this attempt began) — but that reasoning lived
inside one billing expression and left no trace, so a call billed for the third of
three attempts read exactly like a clean first-time one.

A failover on an entry-backed session ALSO writes an `interview_failover` pipeline
event (`recordAutomationEvent`, actor `auto:interview-connect`, best-effort with a
loud log on failure), so the swap is answerable from the candidate's timeline months
later rather than from rotated server logs.

The pair rides `InterviewSessionSummary` (`attempts`, `failoverFrom`); the completed
docket card that rendered it as an amber line is gone with the docket (2026-09), so
the timeline event is currently its only reader.

`app/_lib/db/interview-failover-attempts.test.ts` pins the columns on a fresh DB, the
first-connect-does-not-increment rule, the refused-connect case, the COALESCE'd first
failover, "a plain provider write invents no fallback", the cohort cost — and, in a
child process, that a **pre-migration** `interview_sessions` table with a real row is
carried forward across two boots with its transcript intact.

## Self-hosted voice

The ElevenLabs adapter can point at a service you run yourself
(e.g. [Gravitone](https://github.com/xkazm04/gravitone), a CPU-only
STT/TTS/turn-taking service speaking the same Agents WebSocket protocol) by
setting `ELEVENLABS_BASE_URL` to a loopback/private address —
`app/_lib/voice/self-hosted.ts` detects this from the URL alone (deliberately
conservative: a public override is still treated as paid) and
`minute-prices.ts` zeroes the per-minute cost estimate for those sessions. No
browser/client change is required — the signed URL returned by the
self-hosted service is whatever the SDK is told to connect to.

`self-hosted.ts` answers **two different questions**, and every money decision
belongs on the second one:

| Export | Question | Use for |
| --- | --- | --- |
| `isSelfHostedVoice(env?)` | **ENV**: is a self-hosted endpoint *configured on this install*? | which URL to call; whether the local stack is deployed at all |
| `isSelfHostedProvider(provider, env?)` | **SESSION**: is *this* call being served by the free provider? | billing gate, meter debit, credential-mint throttle, cost estimate |

An install can serve ElevenLabs locally and still run **OpenAI Realtime**
sessions, which are billed per minute exactly as before — so
`isSelfHostedVoice()` is never on its own an answer to "does this call cost
money". Conflating the two is the root of the first two Known gaps below. Pass
the provider that will actually **serve**: after failover that is
`connect.provider`, not the one the session requested.

The private-host test applies its RFC1918 / link-local / carrier-NAT ranges only
to an **IPv4 literal**. Read off a name they also matched anything whose first
label happened to be one of those numbers (`https://10.voice-vendor.example.com`),
and a public per-minute host would then have been declared free — the one
direction the conservative contract says must never happen.

## Keyless / degraded behavior

- With no provider keys configured, `voiceAvailability()` reports both
  providers unavailable and the connect route surfaces
  `missingVoiceEnv`/candidate-safe failure copy instead of erroring raw.
- The **Free plan includes 0 `interview_minutes`** (`app/_lib/billing/plans.ts`)
  — candidate-mode and simulation sessions both go through `meterGate` and are
  blocked (402) without a paid plan or credits.
- The interview-lab dev harness path is disabled in production by default
  (`INTERVIEW_LAB_ENABLED`).

## Spoken output (TTS) and the provider preference

Plain text-to-speech (no listening) is a separate plane from the conversation providers
above: the portable `packages/voice-tts` package behind `/api/tts`, with a compare-by-ear
panel on `/interview-lab` (ElevenLabs cloud vs local Piper/Kokoro). The onboarding skill
writes `KP_VOICE_PROVIDER` for the conversation default (honored by `pickDefaultProvider`
when that provider is configured) and `KP_TTS_PROVIDER` / `KP_TTS_PROVIDERS` for spoken
output. Details: [docs/architecture/voice-tts-package.md](../../architecture/voice-tts-package.md).

## Known gaps

- **The free→paid boundary is now closed on all three seams that once crossed it.**
  This section used to list three open gaps here; all three ship fixed, and the
  code that fixed them is where the reasoning lives:
  - `/api/interview/connect` sizes its per-token throttle from
    `isSelfHostedProvider(provider)` — the SESSION fact — decided *after* provider
    resolution, so an OpenAI session on an install that also runs a local voice
    service gets the paid budget of 6/10 min, not the free 120. It also passes
    `availability: { ...voiceAvailability(), openai: false }` when the preferred
    provider is the self-hosted one, so a failover can no longer rescue a
    gate-skipped session onto a paid provider.
  - `/api/interview/complete` guards its `recordMeterUsage("interview_minutes", …)`
    with the symmetric `isSelfHostedProvider(session.provider)`, so a self-hosted
    install no longer burns prepaid minutes on calls that cost nothing. The
    `llm_usage` row stays unconditional on purpose: `voiceMinuteCostUsd` prices
    those at 0, and a $0 ledger row is the truthful record that a call happened.
  - `app/api/intake/[id]/voice-connect/route.ts` mints `getVoiceAdapter("openai")`
    and nothing else, so its limit is simply `6` — the raise was never earned there.

  All three limits are pinned in `app/api/rate-limit-contract.test.ts`.
- ASR can corrupt technology terms in transcripts (a "low WER, high semantic
  damage" failure — a spoken skill can be silently substituted for another
  before the scorecard scores it). Two biases now push against it: the
  account-wide `asr.keywords` list deployed onto the agent, and — since
  `@elevenlabs/client` 1.21.0 added `overrides.asr.keywords` — a **per-job**
  list the server builds from `requirements[].skill` + `detectedSkills`
  (`interviewAsrKeywords` → `/api/interview/connect` → the SDK override, capped
  at 50 terms with the floor list filling the remainder). The spoken eval's
  headless init frame forwards the same list (`conversation_config_override.asr.keywords`)
  so WER/entity numbers describe the biased recogniser, not the dashboard default.
  Both need the agent to have been created with the `asr.keywords` override
  unlocked, or the platform silently ignores the per-session list and the call
  runs on the account-wide one. **Deployed 2026-08-21** — `--check` reports zero
  drift. That deploy also corrected two live defects the drift report surfaced:
  the agent was running a `max_duration_seconds` of 600 (grounded screens book
  15–30 min, so long calls were being cut off mid-answer) and a 717-char prompt
  predating the one-question-per-turn and language-lock rules. Re-run
  `node scripts/setup-eleven-agent.mjs --check` after any dashboard edit; a
  `--deploy` rotates `ELEVENLABS_AGENT_ID` and needs the id updated anywhere
  else that pins it.
- The per-job list is built from the JOB only. The candidate's own CV-extracted
  technologies would sharpen it further and are not read yet.
- Sub-specialty language drift and a handful of interviewer-persona
  refinements (praise suppression, one-question-at-a-time, terse-candidate
  drawing-out) are tracked as ongoing prompt tuning, not code gaps — see
  [`docs/development/voice-interview-testing.md`](../../development/voice-interview-testing.md)
  for the eval harness that measures them.

## Testing / evaluation

The interviewer prompt is hardened by a dedicated text+voice eval harness —
see [`docs/development/voice-interview-testing.md`](../../development/voice-interview-testing.md).
