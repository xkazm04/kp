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
  mail names the actual reason. A failed prior attempt shows a resume notice
  before Start, explaining that saved answers return when the call reconnects.
- Recruiter dev/demo harness: `app/interview-lab/page.tsx` — a keyless lab for
  trying the agent as a recruiter would; gated by `INTERVIEW_LAB_ENABLED=1`
  outside production. Its language picker offers auto-detect and all four
  shipped locales (Czech, English, German, French) for provider comparisons.
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
   length-capped. The candidate display label is also reduced to its first
   line, stripped of control and bidirectional formatting characters, and
   capped at 80 characters before it enters this client-sent prompt. Pinned by
   `app/_lib/voice/candidate-brief.test.ts`.
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
     `"Permission denied"`. That same forwarding means the classifier is reached
     with **provider** text, not only with `getUserMedia` text — so its nameless
     message fallback must not match a bare "denied". It used to
     (`/permission|denied|dismiss/`), and an auth or agent-access failure reading
     `"Agent access denied"` therefore told the candidate to click the microphone
     icon in their address bar for a failure they cannot fix that way, instead of
     falling through to the honest session error. The fallback now matches only
     the phrases `getUserMedia` itself emits (`permission denied` /
     `permission dismissed`); a real browser denial is classified by
     `DOMException.name` and is unaffected, on both transports and on the JD
     intake voice surface that shares the classifier. Pinned by
     `app/_components/voice/micErrorText.test.ts`.
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
   The transcript language-lock verdict uses clear grammatical markers; isolated
   tech loanwords such as “role”, “project”, and “experience” leave the language
   indeterminate so a Czech answer is not misreported as an English switch.
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
| `app/_lib/voice/director-tools.mjs` | The six tools (`begin_topic`, `mark_topic_covered`, `report_guardrail`, `forward_question`, `report_extra_time`, `end_interview`) and `DIRECTOR_NOTE_PREFIX` (`[Director]`), shared by both providers. |
| `scripts/setup-eleven-agent.mjs` | `--deploy` creates or reuses the six tools as ElevenLabs **client** tools and references them in `conversation_config.agent.prompt.tool_ids`. `--check` follows those ids and diffs each tool's config (`app/_lib/voice/eleven-agent-diff.mjs`). |

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
    Fixed blocks come off first, and the kit is fitted into the rest. When the link pins
    a job kit and the interview is the kit-only or the CV-plan branch, that booking is
    the kit's own length (see "The kit in the interview").
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
- **A same-block cover rule was tried and withdrawn (2026-09-18).** The rule accepted a
  cover only for words said while that block was active. In a live simulator re-run it
  refused true evidence 3 times out of 3, because the interviewer often asks a block's
  question before it calls `begin_topic` for that block, so the answer is recorded under
  the previous block. Coverage fell from 6 of 6 scored blocks to 2 of 6, which would also
  have triggered needless overrun requests and false "required question not asked" rows.
  A quote may therefore match any persisted candidate turn of the session. The
  simulator's verdicts measure how often a cover quotes an answer recorded under another
  block, and whether that answer was about the covered topic, before any rule is designed.
- ~~A directed call longer than `LIVE_INTERVIEW_RECENCY_MIN` stopped counting as
  live~~ — fixed: every director exchange stamps `interview_sessions.last_activity_at`
  (`touchInterviewActivity`), and `isInterviewSessionLive` reads the later of it and
  `updated_at`. `updated_at` stays the connect time, because the minutes debit and the
  director's clock read it as the current attempt's start.
- ElevenLabs sessions stay undirected until the agent is re-provisioned with the client
  tools.

## The job interview kit

### The job interview kit

Target: `docs/features/interviews/README.md` (owns `app/_lib/interview-*.ts`). The
doc-sync diff check will also name `docs/features/jobs/README.md` (`app/api/jobs/**`),
`docs/features/pipeline/README.md` (`automation.py` / `automation_cli.py`),
`docs/features/compliance/README.md` (`db/pipeline.ts` — the ERASURE_EXEMPT row),
`docs/features/organization/README.md` (`tenancy.ts`) and
`docs/architecture/api-contracts.md` (`api-response.ts`). A one-line pointer to this
section from each is enough; the substance lives here.

Before this, every candidate's interview questions came from that candidate's own CV. Two
people applying for the same role were asked different things, so their ratings could not
be compared, and a recruiter had nothing to write, review or reuse. The job interview kit
is the job-level material every interview for a role is run from: the competencies the
role is hired on, what is asked about each, how long each gets, which questions can never
be skipped, and a short FAQ the interviewer may answer role questions from. The
per-candidate plan still adds probes from the CV, and a recruiter's per-candidate edits
(`KitOverlay`) sit on top of both.

#### Entry points

| Surface | What it does |
| --- | --- |
| `GET /api/jobs/[id]/interview-kit` | The latest **published** version, the latest **draft**, and the version list (summaries, no payloads). |
| `POST /api/jobs/[id]/interview-kit` | Starts the background task `interview_kit`, which generates a new **draft**. Returns `{ taskId }`. Spends one model call. |
| `PUT /api/jobs/[id]/interview-kit` | Saves an edited kit `{ kit }` as a **new** draft version with `source: "edited"`. Returns `{ kit, adjusted }`. |
| `POST /api/jobs/[id]/interview-kit/publish` | `{ kitId }`. Makes one version the one new links are minted from. |
| `latestPublishedKit(jobId, ws)` / `kitById(kitId, ws)` (`app/_lib/interview-kit.ts`) | The read seam the interview side uses. It returns the kit new links mint from, or the one version a link pinned. |

#### Versioned and append-only

`interview_kits` stores one row per **version** (`db/interview-kits.ts`). An edit, a
regeneration and a hand-authored save each insert a new version. Nothing ever rewrites a
version's `kit_json`. There are two reasons:

- A regeneration must never silently overwrite a recruiter's edit. This is the reason
  `agent_fit_specs` already records.
- A candidate's interview link is **pinned** to the version it was minted with. Everyone in
  one round is asked the same things, and a later edit cannot change what an interview
  that already happened asked.

The only UPDATE the table allows is `status` going from `draft` to `published`
(`interviewKitPublish`). It is allowed because it leaves `kit_json` untouched: it changes
which version new links mint from, and it does not change what any version asks. The flip
is a single guarded statement (`… AND status = 'draft'`), so two publishes racing each
other end with one winner and one 404.

Versions are numbered per `(workspace, job)` inside an IMMEDIATE transaction, and a UNIQUE
index on `(workspace_id, job_id, version)` backs this up. The read order is `version`, not
`created_at`: a draft generated and then published within the same millisecond is a real
case.

**Publish semantics.** `latestPublishedKit` returns the highest published version. An older
published version is not demoted. It stops being the highest and stays readable, so links
pinned to it keep resolving. A generated version is **never** auto-published: the runner
only appends drafts, and a person has to publish.

#### What a kit is

The contract is `app/_lib/interview-kit-types.ts`:

- **Competencies**, 1–8. Each has a title that is read to the candidate, so it carries no
  assessment wording, and a **weight** of 1, 2 or 3. Weights set the order and mark
  emphasis, and no total is ever computed from them. Each also has a **budget** in whole
  minutes, 1–240. The agenda fits the kit to the length the candidate was actually booked
  for, so the budget works as a ratio as much as a duration.
- **Questions**, 1–6 per competency. A **must-ask** is asked even after time runs out.
  There are at most 5 must-asks across the whole kit, and each question can have an
  optional narrowing follow-up.
- **FAQ**, at most 12 entries. These are role facts the interviewer may answer from,
  never a promise about the candidate's chances.
- An optional **note** from the author to the interviewer. It is never read aloud.

#### The trust boundary (`app/_lib/interview-kit-validate.ts`)

Both ways a kit arrives are untrusted in the same way: a recruiter's PUT is arbitrary JSON
from a browser, and the generator's output is arbitrary JSON from a model. So one pure
normalizer serves both, and it follows one rule:

- **Caps are repaired by truncation**, keeping the author's own order. A must-ask over the
  cap is **demoted**, never dropped. Every repair is reported in `adjusted`
  (`competencies_truncated`, `questions_truncated`, `faq_truncated`, `must_asks_demoted`,
  `text_truncated`, `ids_minted`), so the editor can say what changed.
- **A wrong value is refused**, not replaced with a default: a weight outside 1–3, or a
  budget that is not a positive whole number of minutes. Silently putting in a weight
  nobody typed would present the product's guess as the recruiter's emphasis.
- **A kit with nothing to ask is refused**: no competency, a competency with no title, or a
  competency with no question.
- **IDs are unique across the whole kit.** Questions, competencies and FAQ entries share one
  namespace, because an overlay drops a question by id. A valid incoming id is kept, so an
  edit does not orphan overlays already written against it. Missing, malformed or
  colliding ids are minted.

A refusal is `INTERVIEW_KIT_INVALID` (400), with `reason` and `at` sent alongside as data.
The normalizer never throws.

#### Generation, and the keyless path

`interview-kit-run.ts` writes the job and a projection of its promoted RoleBrief
(`kitBriefProjection`: summary, responsibilities, success criteria, dealbreakers,
outcomes; never the per-requirement rationale or provenance) to a workdir. It then spawns
`python -m pipeline.jobfit.automation_cli interview-kit --job-json … [--brief-json …] --lang …`,
sends the result through the same normalizer, and appends it as a **draft** with
`source: "generated"`. `--brief-json` is omitted when the role never went through an
intake, so "no brief" and "an empty brief" look different to the prompt. The kit is written
in the workspace's default language.

The Python side is `automation.interview_kit(job, brief, *, lang, provider)`, prompt
`interview-kit-v1`. Its prompt draws on the registry's `interview-round-design` and
`structured-interview-scorecards` subjects:

- 4–6 competencies, each a separate basis for the decision and observable in a
  conversation, not in a certificate or a work sample.
- 2–4 questions per competency, each asking what the candidate **did**. No
  self-ratings, no hypotheticals, and no assumptions about the candidate.
- A FAQ drawn **only** from facts it was given. It never invents a salary, a start
  date, a team size or a process step.

The coercer holds weights and budgets inside what the TS boundary accepts. The TS side
**refuses** a wrong number from a person, and the Python side **coerces** one from a model,
so one bad number does not throw away a paid call. A model answer that coerces to nothing
falls back to the template as a whole and is reported as `deterministic`.

**Keyless is a supported path.** With no provider, `deterministic()` builds the kit from the
role's own stated requirements: must-haves first (weight 3, opening question marked
must-ask up to the cap), then nice-to-haves (weight 2), then detected skills (weight 1).
Duplicate skills are merged regardless of case, and there are at most 6 competencies. Each
gets two behaviourally anchored template questions. A role with no parsed requirements gets
one "Recent work" competency rather than an empty kit. The keyless FAQ answers only from
fields the posting **stated**: a location, work mode or seniority that `normalize_job`
filled in as a phantom default is never presented as a fact. The task result's `source`
says which engine wrote the kit, and the task drawer shows it.

The task kind `interview_kit` is scoped to the workspace, deduplicated per job (a second
click while a draft is being generated joins the run already in progress instead of
appending a stray version), and budgeted as `metered`. It uses the `automation` model use
case.

#### No candidate data, ever

A kit row holds nothing about a person, and this is a hard boundary. The GDPR erasure
scrub is keyed by pipeline entry (`scrubEntryLinkedPii`), so it cannot reach a row keyed by
job: anything about a candidate stored here could never be deleted. The generator takes
no candidate input, and its signature is pinned. The normalizer emits only the contract's
keys, so a pasted `candidateName` never reaches the column. The table's columns contain no
field that identifies a person. `interview_kits` is in `ERASURE_EXEMPT` (`db/pipeline.ts`)
as role material, and `db/interview-kits-shape.test.ts` keeps that statement true.
Per-candidate material belongs in `interview_preps`, which the scrub does blank.

#### Tenancy

Every statement binds `workspace_id`, including point reads, and there is no exception for
reads by id (`interview-kits-tenancy.test.ts`, with an empty exemption list). A shared
corpus role can have a separate kit in each team. A leaked kit id is what a minted link
carries, so it must not resolve for another team. Every route resolves the caller's
workspace. GET applies the list's visibility check, and the writes apply
`canWriteJobLifecycle`. A job that is unknown or belongs to another team gets 404
(`JOB_NOT_FOUND`), not 403, on every verb.

The **runner checks ownership itself** (`runInterviewKit` → `canWriteJobLifecycle`). The
route is not the only way in: `POST /api/tasks` starts any known task kind with parameters
the client supplies. Without this check, a team could name another team's private role,
spend its own model call on it, and read that role's requirements and stated facts back
out of the task result.

#### Authorization, limits, refusals

- All three writes ask for `pipeline:write` (`requireCapabilityCoded`) **first**, before
  the 404 and before the throttle.
- The generate POST is rate-limited per IP at 20 per 10 minutes, the same budget as
  agent-fit and campaign, and this is pinned in `app/api/rate-limit-contract.test.ts`. PUT
  and publish are ordinary authenticated row writes and are deliberately not limited.
- A PUT body is capped at 64 KB and a publish body at 4 KB (`PAYLOAD_TOO_LARGE`, 413).
- Publish answers `INTERVIEW_KIT_NOT_FOUND` (404) for an unknown version, a version
  belonging to another role (checked **before** the flip, because the table cannot undo a
  publish), and an already-published version. These are one answer on purpose, so the
  endpoint does not reveal which ids exist.
- A store or spawn fault returns `INTERVIEW_KIT_FAILED` through `safeJsonError`.

#### Data model

`interview_kits (id, workspace_id, job_id, version, status 'draft'|'published', kit_json,
source 'generated'|'edited', created_at)`. It has a UNIQUE index on
`(workspace_id, job_id, version)` and an index on `(workspace_id, job_id, created_at)`.
The table is created in the main `core.ts` schema block.

#### Known gaps

- The generator's model path (`source: "llm"`) is exercised only with a fake provider in
  `test_interview_kit.py`. No live-model output has been reviewed against the prompt.
- The generate POST is backgrounded. The unit suite drives it up to its refusals and
  checks the order of gate, throttle and enqueue from the source, because the enqueue
  spawns Python and `test:unit` is Node-only.
- There is no way to delete or archive a stale draft. The version list only grows.
- A run's `adjusted` notes and its engine `source` (`llm` / `deterministic`) are in the
  task result but not on the row. The row's `source` field records generated versus
  edited, not which engine wrote it. After the task has been pruned, a stored draft cannot
  say whether a model or the template wrote it.

## The kit in the interview

### The kit in the interview

A job can carry a published **interview kit**: its competencies, their questions, which
questions are must-asks, a weight and a time budget for each competency, and a short
recruiter FAQ. The kit is the **spine** of every AI interview for that job. The
competencies replace the topics the agenda used to generate from each candidate's own
CV, so candidates in one round face the same questions. The kit itself is authored and
versioned by the job's kit store (see the kit section of this doc). This section covers
what the interview does with it.

#### Entry points

| Where | What |
| --- | --- |
| `app/_lib/interview-invite.ts` (`mintAndInviteVoiceScreen`) | **Pins the kit at mint.** It resolves `latestPublishedKit(jobId, workspace)` and stores that version's id on the new session (`interview_sessions.kit_id`, via `createInterviewSession({ kitId })`). A job with no kit pins `NULL`. A kit that can't be read is logged and also pins `NULL`, and the invite still goes out. It pins the kit **before** the grounded build and hands the pinned version to `buildGroundedInterview` (`pinnedKit`), which books the kit's length and states it in the saved fallback brief. The reservation and the invite email use that booking. |
| `app/_lib/interview-kit-booking.ts` | `kitBookedMin(kit, prep?)`, the single rule for a kit-pinned interview's booked length. It also holds the pure rules it shares with the agenda builder: the overlay (`applyKitOverlay`), the capped CV probes (`kitCvProbes`), the plan's frame (`prepFrame`) and the fixed-block minutes. They moved out of `interview-agenda.ts`, which re-exports them, and the module stays out of the agenda builder's import graph because the scheduling estimate reads it. |
| `POST /api/interview/connect` | Passes the session's **pinned** `kitId`, not the job's latest kit, to `buildInterviewKit`. |
| `app/_lib/interview-agenda.ts` | `buildInterviewKit(entryId, ws, { bookedMin, kitId })` reads the pinned version with `kitById`, applies the candidate's overlay (`applyKitOverlay`) and drafts the branch from it. `cvProbeId(text)` gives a per-candidate probe an id the overlay can name. |
| `app/_lib/voice/director-brief.ts` | `kitQuestionListing` lists a kit block's questions in authored order with each must-ask marked on its own question; the private listing marks the heaviest weight. `directorProtocol(facts, faq)` renders the kit FAQ into ROLE FACTS. |
| `app/_lib/voice/candidate-brief.ts` | `sanitizeFaqEntries` is the allow-list pick for the FAQ: question and answer only, one line each, the first 6 entries, answers capped at 300 characters. **Both** briefs take the FAQ through it. |
| `app/_components/voice/useDirector.ts` + `call-observations.ts` | The browser's fallback hard stop re-arms from each director response's `clock` (`extendedHardStopDeadline`). |
| `app/_lib/interview-evidence.ts` + `app/features/hiring/schedule/ScheduleInterviewObservations.tsx` | `must_ask_unasked` is projected as `unaskedQuestion` / `unaskedQuestionId` / `endReason` and rendered as "Required questions not asked". |
| `app/_lib/voice/director.ts` | The must-ask rule: `outstandingMustAsks`, `endCeilingMin`, the `ask_overrun` directive, `report_extra_time`, the extended `prematureCompletion`, and `must_ask_unasked` rows when a call ends. |
| `app/_lib/voice/director-tools.mjs` | A sixth tool, `report_extra_time(answer: agreed \| declined)`, and `OVERRUN_ANSWERS`. The README's entry-point table must say **six** tools now. |

#### The agenda, per branch

The branch order is unchanged: **debrief > case-grounded student > generic student > prep
chronology**. A fifth branch, `kit`, applies when a candidate has no prep of their own.
The kit is a complete agenda without one. Before the kit, such a candidate had no agenda,
and the call fell back to the generic prompt.

| Branch | With a pinned kit |
| --- | --- |
| **Work-sample debrief** | The branch **keeps** its authorship probes (the approach block and one "Decision n" block per minted question). The kit's must-ask questions are **appended** as one extra block. This is the only branch the kit doesn't spine, because it is the only place the product checks that a candidate authored their submission. |
| **Case-grounded / generic student** | The script's first phase (the opening move) and last phase (the closing move) stay. The kit's competencies replace the phases in between. The case narration lives in the brief and is unaffected. |
| **Prep chronology** | The kit's competencies replace the per-candidate topics. The plan's frame stays: the opening's minutes, its `open` slack block and the wrap-up's minutes. |
| **Kit only** (no prep) | Warm-up, the kit's competencies, then the closing pair. |

Each kit competency becomes **one `topic` block**, in the kit's order, with the kit's
budget as its planned minutes. The block carries the competency's questions as `questions`
(aloud material) and two fields that exist only on kit blocks:

- `mustAsks: { id, text }[]` lists the questions the kit marks as required. The director
  reads it.
- `weight: 1 | 2 | 3` sets emphasis in the **private** brief only. It orders nothing, since
  the kit's own order is the agenda's order, and nothing ever adds weights up into a total.

**This candidate's own probes ride on top.** In the prep branch, the recruiter's imported
questions come first, then the chronology's aloud questions. Both are de-duplicated
against what the kit already asks, capped at `MAX_KIT_CV_PROBES = 3`, and put in one block
titled with the catalog's "recruiter-added questions" string. The cap is three because the
kit already fills the booking. Every added probe shortens every kit block
(per-question-time-budget-that-tightens), and the point of the kit is a shared instrument.
The prep pack still lists every generated question. Only the agenda drops them.

**The recruiter's overlay rides over all of it.** It is stored as `kitOverlay` on the
candidate's prep payload. That key is human-owned, so `mergeRegeneratedPrep` keeps it
across a Regenerate. It is narrowed by `coerceKitOverlay` and applied to the authored kit
**before** any branch drafts from it:

- `dropped` removes a question by id. A dropped must-ask stops being required for this
  candidate.
- `edited` rewrites a question's text in place and keeps its id, position and must-ask flag.
- `added` appends to the named competency. With no competency, or one this kit version no
  longer has, it goes into one trailing block at weight 1. At most
  `MAX_OVERLAY_ADDED_QUESTIONS` (6) additions are applied.
- An id that the pinned version doesn't carry is ignored.
- A malformed overlay counts as no overlay.

The overlay can also name **this candidate's own probes**. A prep chronology carries no
question ids, so each probe's id is derived from its text: `cvProbeId(text)`, which is
`cv-` plus the 32-bit FNV-1a hash of the trimmed text. `dropped` and `edited` apply to the
probes before the cap of 3, so dropping one lets the next probe move up. A regeneration
that rewrites a probe gives it a new id, so the old overlay entry stops matching and is not
applied.

The agenda invariants hold unchanged on every kit-spined agenda: ids `b0..bN`, Σ budget
equal to the **booked** duration, `hardCapMin = round(duration × 1.2)`, `closeReserveMin =
role_qa + close`, and `scored` only on topic/open. With no kit, every block has exactly the
seven fields it always had. `interview-kit-agenda.test.ts` pins that a missing or
unresolvable pin produces the same agenda as no pin.

**The booking is the kit's.** Before this, a kit's length was computed in several places
that disagreed. The mint booked the quick screen's 5 minutes for a candidate with no plan,
and connect then squeezed a 20-minute kit to its floors. A candidate with a plan was booked
at the plan's own length, sized for the CV topics the kit replaces. The rehearsal booked
`max(20, natural)` with no ceiling, the scheduling estimate ignored the kit, and the saved
fallback brief said "under 5 minutes". Every surface now asks `kitBookedMin`
(`interview-kit-booking.ts`):

- **No plan:** a 1-minute warm-up, the kit's competency budgets, 2 minutes of role
  questions and a 2-minute closing.
- **A CV plan:** the plan's own opening, the kit's competency budgets, the block the capped
  CV probes take (2 to 4 minutes), then the plan's role questions and closing. These are
  the same probes and frame the agenda builder uses. The plan's slack block is not booked,
  so connect drops it rather than shorten a competency.

The recruiter's overlay applies exactly as it does in the agenda. The result is clamped to
the 15 to 30 minute band a CV-based plan is clamped to (`run-of-show.ts`):

- Below 15 minutes a screen is a stub. A short kit's surplus goes to the candidate's
  questions or the plan's slack block, never into or out of a competency.
- At 30 minutes the director's own end stays inside the provider's 40-minute hard cap
  (`PROVIDER_CAP_MIN`): round(30 × 1.2) + 2 = 38 minutes. A kit authored past 30 minutes
  is fitted into 30 proportionally.

The rule is read by the mint (`interview-invite.ts`, for the booking and the saved fallback
brief), by connect's build when no booking is passed (`buildInterviewKit`), by the
rehearsal (`buildKitOnlyInterviewKit`, whose length the rehearse door books) and by the
scheduling estimate (`plannedInterviewMinutes`, using the job's latest published kit, the
one a link minted now would pin). A work-sample debrief and a student script keep their own
length. With no kit, everything books exactly as before. Pinned by
`interview-kit-agenda.test.ts` ("ONE booking rule …", "with NO kit …", "kitBookedMin is
clamped …"), `connect-rehearsal.test.ts` and `interview-spend-doors.test.ts`.

#### The two briefs

| | Private brief (server-minted, OpenAI) | Candidate-safe brief (client-sent, ElevenLabs) |
| --- | --- | --- |
| The kit's questions | Listed. | Listed (they are asked aloud). |
| Must-asks | Each question listed in the kit's authored order, numbered when a block has more than one; a must-ask carries `— Required, never skipped even if you are over time.` on its own question, and a follow-up comes straight after the question it follows. | Not marked. |
| Weight | Only weight 3 gets a line: "carries the most of the decision — protect its time". | No. |
| Kit FAQ | In ROLE FACTS: "The recruiter also answered these, and you may answer them the same way: …" | The **same** sentence, word for word. |
| `report_extra_time` | Named in the protocol. | Named in the protocol. |

FAQ answers are recruiter-written role facts meant to be said to candidates, so both
providers carry them. Otherwise the two providers would answer the same question
differently, which is the split the directed agenda removed. Both briefs take the FAQ
through `sanitizeFaqEntries` in `voice/candidate-brief.ts`, the allow-list boundary.
Only the question and the answer survive: an entry's id and anything else never do.
The must-ask marker, the weights and the author's note never reach the candidate-safe
brief.

**The order is the author's.** A kit block's private note is built by
`kitQuestionListing` (`voice/director-brief.ts`, called from `interview-agenda.ts`). It
lists the questions in the kit's authored order, marks each must-ask on its own question,
and puts each follow-up straight after the question it follows. The note used to list the
optional questions and every follow-up first and the must-asks last, and a live
interviewer then read "What would you change in *that* service?" before the question that
introduces the service. `privateAgendaListing` never states a must-ask twice: it prints no
separate "Required …" line for a must-ask the note already marks. A block with no note
keeps that line, which covers the work-sample debrief's appended required questions and a
resumed call whose stored agenda no longer matches the fresh notes. The candidate-safe
brief is unchanged. Pinned by `interview-kit-agenda.test.ts` and `director-brief.test.ts`.

#### Must-asks and the overrun

A must-ask is asked even when the clock has run out. The overrun is **asked for, never
taken silently**. The absolute ceiling is `MUST_ASK_CEILING_FACTOR × booked = 2×`, which is
the reservation the mint already took (`maxBillableInterviewMin`).

"Asked" is **block-grained**. `mark_topic_covered` is the only per-block evidence the
protocol has, so an uncovered block's must-asks count as outstanding. This errs toward
telling the recruiter that a required question may have been missed.

| Condition | What the interviewer is told or does | What is recorded |
| --- | --- | --- |
| Before the close reserve | Ordinary pacing. `end_interview("complete")` is refused with the ordinary "N topics remain". | `end_requested { refused: true }` |
| Close reserve reached, a must-ask outstanding, not yet asked | **`ask_overrun`** (once per session, before `close_now`, even if the model already wandered into the closing): say you are at time, name how many required questions remain, ask for a few more minutes, and call `report_extra_time` with the answer. | `directive { kind: ask_overrun }` |
| Asked, no answer yet, under 60 s (`OVERRUN_ANSWER_GRACE_MS`) | Nothing. The question gets its minute. | — |
| `report_extra_time("agreed")` | Tool result: ask the required questions that remain. The director says nothing while the active block owes one, and otherwise sends `move_on` to the first block that does. `close_now` and the hard-cap `end_now` are suspended. | `overrun_answered { answer: agreed, remaining }` |
| `report_extra_time("declined")`, or no answer after 60 s | `close_now` immediately. Ends at the ordinary hard cap + 2. | `overrun_answered { answer: declined }` (nothing when silent) |
| `report_extra_time` with no request outstanding | "No extra time was requested". The model can't grant itself an extension. | nothing |
| `end_interview("complete")` past the reserve with a must-ask owed | Refused: "N required questions remain. Continue with bX · …", until the candidate declines or the call reaches its end ceiling. | `end_requested { refused: true }` |
| Agreed, elapsed ≥ 2 × booked | `end_now`, `endCall: true`. | `directive { end_now }` |
| Any accepted `end_interview` (complete, time or candidate_request) | Closing line, then the call ends. | `end_requested` plus **one `must_ask_unasked { questionId, question, endReason }` per outstanding must-ask** |

`candidate_request` is never refused: the candidate may stop at any time. The server's
`endCall` in `director-step.ts` reads the same `endCeilingMin` as `end_now`.

**The browser's fallback stop follows the moved limit.** Every `POST /api/interview/director`
response now carries `clock: { elapsedMs, endLimitMs } | null`. Both values are live
milliseconds on the server clock. `endLimitMs` is `endCeilingMin × 60 000`. `clock` is null
when the call has no agenda. `useDirector` still arms the stop at connect (hardCap + 2,
minus the time earlier attempts used). That arming is the **floor**, so the stop still
fires if the director can't be reached. After each response,
`extendedHardStopDeadline` computes `now + (endLimitMs − elapsedMs)`:

- The stop is re-armed only when that deadline is at least 1 s later than the armed one.
  It is never moved earlier.
- The deadline is bounded by `max(hardCap + 2, 2 × booked)` from the candidate agenda view,
  so a garbled body can't hold a call open past what the booking allows.
- The re-arm cancels the one stop timer it replaces through the timer registry's per-timer
  cancel. It never calls `clearAll`.
- A reconnect retires the previous attempt's stop instead of leaving two armed.

#### Data model

- `interview_sessions.kit_id` (TEXT, nullable). The pinned kit version is written once, at
  create, and never moved.
- `interview_events` gains two kinds: `overrun_answered` (`payload.answer`,
  `payload.remaining`) and `must_ask_unasked` (`payload.questionId`, `payload.question`,
  `payload.endReason`). The unasked question is the kit's own text, not the candidate's
  words.
- Prep payload: the `kitOverlay` key (a human-owned `KitOverlay`, version 1).

#### Keyless behaviour

Nothing here calls a model or a key. The pin, the agenda, the overlay, the briefs and the
director policy are all deterministic reads and pure functions. A job with no kit behaves
exactly as it did before.

#### What the recruiter sees

The evidence door projects `must_ask_unasked` into dedicated fields: `unaskedQuestion`,
`unaskedQuestionId` and `endReason`. They are not the candidate's words, so they are
separate from the candidate-words `question` field. `redactEvidenceEvent` removes the
candidate's words when consent lapses and leaves these fields in place.

The Observations panel (`ScheduleInterviewObservations.tsx`) shows **"Required questions
not asked"** with each question, its block and why the call ended (the interviewer closed
it, it ran out of time, or the candidate asked to end it). The panel says in words that
this describes how the interview ran, not the candidate. The section appears only when
there is a row: a call with no kit had nothing required, and "none missed" would claim a
check that never ran. `overrun_answered` is deliberately projected as a bare kind, because
whether a candidate agreed to stay longer is not something a recruiter should read about
them. Catalog keys: `scheduleTab.transcript.evidence.mustAsk*` (4 locales).

#### Known gaps

- **The ElevenLabs agent must be redeployed** (`scripts/setup-eleven-agent.mjs --deploy`)
  before it can call `report_extra_time`. Until then an EL call's overrun request can't be
  answered, which is treated as no agreement, so the call closes on time.
- **Must-asks are block-grained.** A covered block counts as having asked all its
  must-asks.
- **The candidate-safe brief doesn't mark which questions are required.** The `ask_overrun`
  and `move_on` directives carry the requirement at the moment it matters.

## Authoring the kit

### Authoring the kit

#### Authoring the kit

The job interview kit (see "The job interview kit" above) has two recruiter surfaces: a
**Kit tab** in the job posting modal, where the job's kit is drafted, edited, published and
tried, and a section in the **interview prep modal**, where a recruiter changes the kit for
one candidate without changing it for anyone else.

##### Entry points

| Surface | What it does |
| --- | --- |
| Job posting modal → **Interview kit** tab (`app/features/library/jobs/JobsKitTab.tsx`) | Shows the live version, any newer draft and the version history. Drafts a kit from the posting, edits it, saves the edit as a new version, publishes a version and opens a practice interview on it. The tab id `kit` is in the closed vocabulary `jobsPostingModalTabs.ts`. |
| Schedule → interview prep modal → **AI interview questions for this candidate** (`app/features/hiring/schedule/ScheduleInterviewPrepOverlay.tsx`) | The kit this candidate's interview runs on, this candidate's own CV probes, and the recruiter's per-candidate overlay: remove, rewrite or add a question for this candidate only. Renders nothing when the role has no kit. |

##### Flows

**Drafting.** "Draft from the posting" calls `POST /api/jobs/[id]/interview-kit` and follows
the returned `interview_kit` task (`useTaskResult`) to completion, then reloads the kit. When
the finished task's `source` is `deterministic`, the tab says so: no AI provider is
configured, the draft is a template built from the posting's own requirements, and its
questions should be rewritten before publishing. Before the click the hint states the same
fallback. "Write it yourself" opens a blank kit with one unweighted, unbudgeted competency.

**Editing.** The editor opens the newest draft when it is newer than the live version, and
otherwise the live version. Competencies are an ordered list with the pipeline-axis editor's
row grammar: a fixed-width emphasis picker first, then the title, the planned minutes and the
shared move up / move down / remove cluster (`PipelineStepRowControls`, extracted from
`features/shared/PipelineStepRow.tsx`, so both editors name every control per row). Each
competency holds its questions, each with a must-ask toggle and an optional follow-up. The
FAQ and the author's note follow.

- **Emphasis is a word, not a number** ("Decisive", "Important", "Supporting" for weights 3,
  2, 1). Weights order nothing and are never added up, so a digit on screen would read as a
  score the product does not compute. A new competency has no emphasis until the author
  picks one, because the server refuses a missing weight rather than inventing one.
- **Limits are shown before a save could be refused.** Counts sit beside every list, an add
  button disables at its cap, the must-ask toggle closes when the kit-wide budget of 5 is
  spent, inputs carry the text caps as `maxLength`, and the blocking problems (no title, no
  emphasis, minutes outside 1–240, no question) are listed as they appear. What a save would
  silently drop (an empty question, a half-filled FAQ entry) is listed as a note.
- **Must-asks tell the truth about the clock.** The hint every toggle is described by says a
  must-ask is asked even after the booked time runs out, but only if the candidate agrees to
  a few extra minutes, and that a declined overrun ends the call on time with the unasked
  must-asks shown to the recruiter.
- **New items get random ids** (`c-…`, `q-…`, `f-…`) minted in the browser; existing items keep
  their stored ids. The validator mints a missing id by position, so a question saved without
  one could inherit the position, and so the per-candidate overlays, of a question deleted in
  an earlier version.

**Saving** is `PUT /api/jobs/[id]/interview-kit`: always a new draft version, never an edit
in place. The editor reopens on the version the server stored, and shows the server's
`adjusted` report (competencies or questions trimmed, must-asks demoted, text shortened, ids
minted) when there is one. An `INTERVIEW_KIT_INVALID` refusal shows the localized code plus
the competency its `at` names.

**Publishing** is `POST …/publish { kitId }`, from the editor for the open draft or from any
newer draft in the version list. The tab states, before any control, that a publish changes
what interview links sent afterwards carry and never what a link already sent asks. A draft
older than the live version gets no Publish button: new links mint from the highest
published version, so publishing it would succeed and change nothing.

**Trying** ("Try this version") calls `POST /api/jobs/[id]/interview-kit/rehearse { kitId }`
(the rehearsal door, documented with the interview side) and opens the returned
`/interview/<token>` in a new tab. The tab is opened synchronously inside the click, so a
popup blocker sees a user gesture, and is pointed at the rehearsal once the door answers or
closed when it refuses. When the browser blocks it anyway, the link is shown to click. Only a
same-origin `/interview/…` path is followed. Unsaved edits cannot be tried; the button asks
for a save first.

**The per-candidate overlay.** `GET /api/interview-prep?entry=` now also answers `kit`: the
version the candidate's open interview link was minted with (a session in `created`,
`in_progress` or `failed`), else the role's live version, which the next link will carry. The
modal says which of the two it is showing. It lists:

- the kit's questions per competency, marked **Kit**;
- this candidate's own probes, marked **From the CV**: imported questions first, then the
  plan's questions and follow-ups, never one the kit already asks. Only the first 3 ride the
  interview (`MAX_KIT_CV_PROBES`), and the rest say they are not asked. The group is hidden
  when this candidate's branch takes no probes (a work-sample debrief, the student script);
- the recruiter's own questions, marked **Added by you**, under a competency or on their own.

A kit or CV question can be rewritten (and the rewrite undone) or removed (and restored). An
added question can be rewritten, made a must-ask, or deleted. Every row that the recruiter
changed says so ("Rewritten for this candidate", "Removed for this candidate"), and a
rewritten row shows its original. Each change is saved at once with `PATCH
/api/interview-prep { kitOverlay }`, the whole overlay each time, one request in flight and
later edits collapsed into one follow-up. Drops and rewrites that name a question this version
and this plan no longer have are counted, not applied, and can be forgotten.

##### API / lib surface

| Path | Role |
| --- | --- |
| `PATCH /api/interview-prep?entry=` `{ kitOverlay }` | Replaces the candidate's overlay. Same gate (`pipeline:write`, first), throttle (the shared 600/10 min `interview-prep:<ip>` bucket), tenancy read and 404 as the weave that shares the verb. The body is capped at 256 KB (`PAYLOAD_TOO_LARGE`, 413). A malformed or over-cap overlay is `INTERVIEW_PREP_OVERLAY_INVALID` (400) with `reason` as data. A body naming `kitOverlay` is an overlay write and nothing else. |
| `GET /api/interview-prep?entry=` | Adds `kit: { kitId, version, status, pinned, cvProbesRide, kit } \| null`. |
| `app/_lib/interview-prep-kit.ts` | Server-only. `prepKitForEntry(entryId, ws)` resolves the kit above. A read fault is logged and answers null, so it never costs the prep pack. `parseKitOverlayWrite(value)` is the write boundary: stricter than `coerceKitOverlay` (anything coercion would discard is refused, not dropped), entries rebuilt from their known keys, texts trimmed, then `kitOverlayProblems`. |
| `app/_lib/interview-prep.ts` `saveInterviewPrepKitOverlay` | IMMEDIATE read-merge-write of the `kitOverlay` key, like the checklist and scorecard writes beside it. |
| `app/_lib/interview-kit-overlay.ts` | Pure and client-safe. The caps (`KIT_OVERLAY_MAX_ADDED` = 6, `KIT_OVERLAY_MAX_REFS` = 120 drops and 120 rewrites, `KIT_OVERLAY_MAX_TEXT_CHARS` = 600, ids of at most 64 characters, the kit-wide must-ask budget), read by both the modal and the write door. Also a **mirror** of the agenda rules the modal predicts (`kitProbeId` ↔ `cvProbeId`, `applyOverlayToKit` ↔ `applyKitOverlay`, `narrowKitOverlay` ↔ `coerceKitOverlay`, and the probe ordering and cap), because the real ones import the database. `interview-kit-overlay.test.ts` runs each mirror against the real function and once end to end through `buildInterviewKit`. |
| `app/features/library/jobs/jobsKitModel.ts` | The editor's pure model: list reducers, the caps, `kitDraftProblems` (pinned against `normalizeInterviewKit`: no blocking problem means the server stores the draft untrimmed), version helpers, `rehearsalTarget`. |
| `app/features/hiring/schedule/scheduleInterviewPrepOverlayModel.ts` | The modal's rows (origin, state, asked) and the overlay's edit operations. |

##### Data model

No new table. The overlay is the `kitOverlay` key on the candidate's `interview_preps`
payload (`KitOverlay`, version 1). It is human-owned: the generator never writes it, so a
Regenerate carries it (`mergeRegeneratedPrep`, pinned in `interview-prep-run.test.ts`), and the
GDPR erasure scrub reaches it with the rest of the pack. Nothing about a candidate is written
to `interview_kits`.

##### Keyless behaviour

Everything on both surfaces works without a key except the model half of "Draft from the
posting", which falls back to the deterministic template and says so. The overlay, the
version list, saving and publishing are deterministic reads and writes. Trying a version needs
a configured voice provider; without one the rehearsal door refuses with
`INTERVIEW_PROVIDER_UNCONFIGURED`, and the tab shows that message.

##### Known gaps

- Only the open draft and the live version can be opened in the editor. The GET returns the
  other versions as summaries, and there is no read of one version's content by id.
- The engine note (AI or template) exists only in the session that ran the generation. The
  stored row records generated versus edited, not which engine wrote it.
- The kit shown in the prep modal is resolved from `latestInterviewByEntry`, which prefers a
  session with a transcript. A candidate whose completed call is followed by a newer, unused
  link is shown the live version rather than that link's pin.
- The server checks an overlay's added must-asks against the kit-wide cap on their own. The
  modal also counts the kit's own must-asks this candidate still faces, but a client that
  bypasses the modal can store up to 5 added must-asks on top of the kit's.
- Neither surface has been driven in a browser. The pure parts and the write door are unit
  tested; the rendering, both themes and the new-tab behaviour are not.

## Rehearsing a kit

### Rehearsing a kit

A recruiter can hear the real interviewer run a job's kit — its agenda, both briefs, the
director and its tools — before any candidate meets it. A rehearsal runs the job
**template** with no candidate attached. You can rehearse any version of the job's kit,
including an unpublished draft, which is the main reason the feature exists.

**Entry point.** The kit editor's "Try this kit" button calls
`POST /api/jobs/[id]/interview-kit/rehearse` with `{ kitId }` and opens the returned
`{ url }`, a same-origin `/interview/<token>` path with no `?lang=`. The ordinary public
portal then runs the call.

**What the door mints** (`app/api/jobs/[id]/interview-kit/rehearse/route.ts`): an
`interview_sessions` row with `mode: "test"`, **no `entry_id`**, `kit_id` pinned to the
named version, `job_id` set to the job, `workspace_id` set to the caller's team,
`duration_min` set to the no-plan value of `kitBookedMin` (1 + Σ competency budgets + 2 + 2, clamped to 15 to 30, the same length a no-prep candidate's link on that version is booked for),
`language` set to the recruiter's UI locale, and `run_of_show` set to the kit-only agenda's
candidate-safe titles. The stored `instructions` are only a fallback. They hold the plain
quick-screen prompt with no director protocol, because a brief that describes tools the
session was not given makes the model call tools at random. Rehearsing never publishes
the draft.

Checks run in this order, and each one refuses before anything is written:

| Check | Refusal |
| --- | --- |
| session (`requireOperator`; also refuses a demo cookie) | 401 |
| `pipeline:write` | `FORBIDDEN_CAPABILITY` 403 `{capability}` |
| job ownership (`canWriteJobLifecycle`) | `JOB_NOT_FOUND` 404 |
| body ≤ 4 KB | `PAYLOAD_TOO_LARGE` 413 `{maxBytes}` |
| a kit version of **this** job in **this** team (`kitById(kitId, ws)` + `jobId` re-assert) | `INTERVIEW_KIT_NOT_FOUND` 404 (unknown, another team's, another role's: one answer) |
| a configured voice provider | `INTERVIEW_PROVIDER_UNCONFIGURED` 503 `{provider, need}` |
| the version directs something | `INTERVIEW_KIT_INVALID` 400 `{reason: "no_competencies"}` (the normalizer makes this unreachable) |
| minutes reservation (skipped for a self-hosted provider) | `BILLING_QUOTA_EXCEEDED` 402 `{meter, plan}` |
| throttle `interview-kit-rehearse:<ip>`, 20 / 10 min | `TOO_MANY_REQUESTS` 429 |

Any other failure answers `INTERVIEW_CREATE_FAILED` 500 through `safeJsonError`.

**At connect** (`app/api/interview/connect/route.ts`), a session is a rehearsal when
`isKitRehearsal` is true (`app/_lib/interview-rehearsal.ts`), meaning test mode with a
`kit_id`. A rehearsal gets:

- the **kit-only agenda** from `buildKitOnlyInterviewKit` (`app/_lib/interview-agenda.ts`),
  fitted to the booked length and persisted to `agenda_json`;
- **both briefs** from `buildRehearsalBriefs` (`app/_lib/interview-run.ts`). These are
  composed by the same `composeBrief` / `composeCandidateBrief` the candidate path uses,
  with the director protocol, must-ask markers, weights, the role's intake intent and the
  kit FAQ;
- the **director tools**, the job's own ASR keywords (`jobAsrKeywords`), and the
  resume state on a reconnect.

It gets no CV probes, no per-candidate overlay, no entry, and no "You are speaking with …"
line. A test pins this as an equality. A no-prep candidate on a link pinned to the same
version, booked for the same length, receives the same agenda and a byte-identical private
brief. The ElevenLabs brief differs only by the line that names the candidate. The
recruiter's language (from the connect request, otherwise the one stored at mint) stands
in for the language a candidate chose at apply. If the pinned version cannot be read, for
example because it belongs to another team, the call falls back to the stored snapshot
with no agenda and no tools, and logs the fallback. A test session **without** a kit (the
lab) keeps its old behaviour exactly: no agenda, no tools, and no client-sent prompt.

**On the portal** (`app/interview/[token]/page.tsx` → `interviewPortalOffers` in
`portal-state.ts`), a rehearsal is offered **no audio recording**. `/connect` already
stamped recording consent only for candidate mode, and the page now uses the same rule.
The portal also shows **no status link**, and minting one would be a write against a
candidate's entry. Consent is not required for a test session, but the consent UI still
renders, so the recruiter sees what a candidate sees.

**At completion** (`app/api/interview/complete/route.ts`), the transcript is kept. The
scorecard, the `scorecard_review` approval and the sealed `ai_scorecard` decision are only
created for a **candidate interview**, meaning candidate mode **and** an entry
(`isCandidateInterview`). A test session never gets them, even one that somehow carries
an `entry_id`. The provider-failover marker in `/connect` follows the same rule.

**Billing.** A rehearsal is metered like `/simulate`. It uses real provider minutes, so
the door reserves the worst case at mint (`maxBillableInterviewMin` = 2× the booked
length, on the caller's org). `/complete` debits the actual minutes and writes the
`llm_usage` cost row (`use_case: interview_realtime`) on a completed call. The row links
back only through `request_id` = the session id, and that session has no entry, so the
spend appears in the usage panel without being attributed to any candidate. A
self-hosted provider is neither gated nor debited.

**Keyless.** With no voice provider configured, the door refuses with
`INTERVIEW_PROVIDER_UNCONFIGURED` and mints nothing.

**Known gaps.** The portal shows the candidate's own copy ("A human recruiter reviews the
transcript") because a rehearsal is meant to show the candidate experience. There is no
"rehearsal" banner yet. Rehearsal transcripts are ordinary test-mode rows, hidden from
recruiter lists (which filter on `mode = 'candidate'`). No retention sweep targets them
specifically.

## Candidate call — the browser half of the director loop

The candidate meets the directed interview at `/interview/[token]`. The realtime
provider still runs every spoken turn; the browser is the wire between that provider
and our director, and it owns four things the server cannot: the observations only a
browser can make, the presence the candidate looks at, the end-of-call handshake, and
the hard stop that has to work when the director is unreachable.

### Entry points

| Where | What |
| --- | --- |
| `app/interview/[token]/page.tsx` | The server page. Resolves the session, the AI-disclosure regime, the recording offer and the candidate's `/status` link, then renders one client island. |
| `app/_components/voice/InterviewPortalClient.tsx` | That island: the agenda rail + the call card. It holds the agenda the connect returned and the director's live agenda state, and passes both to the rail. |
| `app/_components/voice/VoiceInterview.tsx` | The call shell: phase, consent, transcript, finalize. |
| `app/_components/voice/useDirector.ts` | The producer channel's React lifecycle — the fetch, the heartbeat, the end handshake, the client hard stop. |
| `app/_components/voice/director-channel.ts` | The wire discipline, pure: seq numbering, resend-above-ack, one tool call per request, serialization, the unreachable-director fallback. |
| `app/_components/voice/useCallObservations.ts` | `focus_lost` / `focus_returned` / `answer_timing`. |
| `app/_components/voice/call-observations.ts` | The arithmetic behind all of the above, plus the end handshake and the hard stop, pure. |
| `app/_components/voice/transport/openai.ts`, `transport/oai-events.ts` | The raw-WebRTC path: tool calls, speech and audio boundaries, the tool-result and directive messages, the two level meters. |
| `app/_components/voice/transport/elevenlabs.ts` | The SDK path: `clientTools`, `sendContextualUpdate`, `onModeChange` / `onVadScore` / `onAgentChatResponsePart`. |
| `app/_components/voice/InterviewPresence.tsx`, `presence-state.ts` | The presence orb and the one derivation behind it. |
| `app/_components/voice/useSpeakerTest.ts` | The keyless speaker check in the pre-call panel. |

### The loop, from the browser's side

1. **Connect.** `POST /api/interview/connect` answers with `agenda`, `attempt`,
   `resume` and `recording` beside everything it answered before. The shell stores the
   agenda (the sidebar switches from the server's run-of-show to the director's block
   titles), seeds a resumed attempt's prior turns into the visible transcript, and arms
   `useDirector` with `{token, sessionId, attempt, agenda, resume}`.
2. **Turns.** Every finalized turn is numbered **per attempt from 0** and queued.
   Anything above the answer's `ackSeq` is resent. Prior turns from a resumed attempt
   are seeded straight into the transcript and never enter this numbering — they carry
   their own attempts' numbers server-side.
3. **Tool calls.** At most one per request, and requests are serialized: a second call
   queues behind the in-flight one. Every answer is handed back to the model —
   OpenAI as a `function_call_output` item plus `response.create`, ElevenLabs as the
   `clientTools` return value.
4. **Directives.** `directive.text` already carries the `[Director] ` prefix and is
   injected **verbatim**: OpenAI as a `system` message with **no** `response.create`
   (a direction is read before the model's next turn; forcing one would talk over a
   candidate mid-answer), ElevenLabs as `sendContextualUpdate`.
5. **Heartbeat.** Every 20 s while live, even with nothing queued — the clock-driven
   directives and `endCall` only reach the browser in a response.
6. **End.** On `endCall` the browser waits for the interviewer's closing line to
   *start* (up to 4 s) and then to *finish* (1.2 s of quiet), then ends through the
   same path the End button uses. A speaking flag that never clears is capped at 30 s.

#### The transcription race is closed

The model quotes the candidate's exact words for `mark_topic_covered` as soon as it
hears them — often before OpenAI's input transcription has finished, so the director
was checking a true quote against a record that did not contain it yet and rejecting
it as `no_match`. The browser now holds the channel for up to **1.5 s** when a
candidate utterance is still being transcribed, and sends the turn and the tool call
in the **same** exchange. Past the grace the call proceeds undirected for that call:
an un-recorded topic costs one question, a stalled tool call costs the interview.

#### A director outage costs direction, never the interview

Every non-2xx — 409 `INTERVIEW_NOT_LIVE`, 429, the coded 500, an offline fetch —
resolves to "unreachable". The waiting model is answered `Continue with the agenda.`
by the browser itself (the exact string `voice/director.ts` would have sent, pinned by
`director-channel.test.ts`), turns stay queued for the next trigger, and nothing is
rendered at the candidate. A 409 additionally closes the channel: that call is no
longer the live one, so posting again cannot help.

The **client hard stop** is the one rule that does not depend on any of this: at
`hardCapMin + 2` minutes of live time — including the seconds earlier attempts spent
(`resume.elapsedSec`) — the browser ends the call itself. The grace is the same
`END_GRACE_MIN` the server's director uses, pinned by a test, so a reachable director
and an unreachable one cannot end the same call minutes apart. The connect-time stop is
a FLOOR: every director response carries `clock: { elapsedMs, endLimitMs }`, and
`useDirector` re-arms the one stop timer later whenever the server's limit moved — which
it does when a candidate agrees to a must-ask overrun (2x the booked length). It never
moves earlier than the server last said, and it is capped at max(hard cap + 2, 2x
booked) from the agenda view, so a garbled response cannot hold a call open
(`extendedHardStopDeadline` in `call-observations.ts`).

### Observations

| Event | When | Fields |
| --- | --- | --- |
| `focus_lost` | `visibilitychange` to hidden, or window `blur`, while live | `during`: who held the floor (`interviewer` wins a tie) |
| `focus_returned` | the tab comes back | `awayMs`, never negative, `0` when the departure was not recorded |
| `answer_timing` | a candidate turn finalizes | `turnSeq`, `preSilenceMs`, `durationMs` |

`preSilenceMs` is the candidate's speech start minus the interviewer's last audio end;
`durationMs` is speech stop minus start. **Either is `null` when the provider does not
expose the event it would come from** — never `0`, which would read as "answered
instantly", a claim about the candidate made by a gap in an SDK. A barge-in (speech
starting before the interviewer finished) records no pre-silence at all. Blur and
`visibilitychange` fire together on a tab switch and are collapsed into one departure.

Nothing in the UI changes because of any of this. No warning, no chip, nothing that
tells a candidate they are "flagged" (registry:
`ai-assistance-detection-and-fairness` — observed-process-is-supporting-not-load-bearing).

### What the candidate sees

- **Presence.** One orb: idle / connecting / listening / thinking / speaking / ended,
  derived once (`presence-state.ts`) and read by the orb, the status pill and a
  `role="status"` live region, so the three cannot disagree. While listening it follows
  the microphone level, while speaking the interviewer's audio; the level is written to
  a mutable box and read on the orb's own animation frame, never through React. Under
  `prefers-reduced-motion` the loop is never armed and the rings are static — the state
  stays fully legible in color, label and live region.
- **Thinking.** The stretch between the candidate finishing and the interviewer's first
  word used to read "Listening", i.e. "your turn" at exactly the moment it was not.
  It is now its own state on both the orb and the pill.
- **The live agenda.** The rail ticks covered blocks and highlights the active one
  (`aria-current="step"`, plus an `sr-only` "happening now" / "done"). Before connect it
  shows the server-rendered run-of-show, unchanged.
- **A streaming caption.** The interviewer's line as it is spoken
  (`response.output_audio_transcript.delta`), rendered **outside** the transcript's live
  region — a caption that re-announced every fragment would talk over the interviewer it
  transcribes — and replaced by the real turn when the provider finalizes it.
- **A speaker check.** A WebAudio two-note tone (no asset, no network, keyless) with an
  "I heard it" confirmation, beside the microphone test. Purely advisory: no browser API
  can confirm a sound was heard, so the verdict is the candidate's own answer and
  nothing about it can block Start.
- **A resumed call.** The earlier attempt's turns are seeded into the visible transcript
  with a seam marker, a line says the call is continuing, and those turns are included
  in the transcript POSTed to `/api/interview/complete`, so the stored record is the
  whole interview rather than whatever happened after the drop.
- **An ending that goes somewhere.** The live closing card now carries the same durable
  `/status/<token>` link the already-completed reload has had for a while.

### A dropped DIRECTED call finalizes `failed`

`interviewFinalStatus` takes an optional `DirectedEndContext` (`directed`, `ending`,
`closingBegun`). A call that was being directed and **dropped** — not the candidate's
End, not the director's `end_interview` — before any `role_qa` / `close` block had
begun is persisted `failed`.

That is not a downgrade, it is the point: `failed` keeps the link reconnectable, and a
reconnect now *resumes* — same agenda, covered blocks intact, the interviewer briefed
not to start over. Calling such a call "completed" would lock the candidate out at
minute 12 of 30 and score half a conversation. Once the closing block has begun the old
rule applies again, so a socket blip at goodbye is still a completed interview.
Undirected calls (the lab, a session with nothing grounded to talk about) keep today's
rule byte for byte. Pinned in `app/_lib/voice/finalize-status.test.ts`.

### Provider specifics

- **OpenAI Realtime (raw WebRTC).** Tool calls arrive as
  `response.function_call_arguments.done` *or* as a `function_call` item on
  `response.output_item.done` (the spelling differs by model line); both are accepted
  and de-duplicated by `call_id`. Speech boundaries come from
  `input_audio_buffer.speech_started` / `.speech_stopped`, interviewer audio from
  `…audio.delta` / `…audio.done`, and "thinking" starts at `response.created`. The
  arguments are handed to the director **unparsed** — it accepts an object or the
  provider's JSON string, and parsing here would turn a provider quirk into a dropped
  tool call.
- **ElevenLabs Agents (SDK).** All six tools are registered as `clientTools` on
  `startSession`; each awaits the director and returns its result string. Directives go
  through `sendContextualUpdate`. Speaking/listening comes from `onModeChange` (which is
  also how the interviewer's audio end is observed), candidate speech from `onVadScore`
  with two thresholds so the flag does not chatter between consonants, and the streaming
  caption from `onAgentChatResponsePart` where the agent emits `text_response_part` —
  otherwise the transcript is turn-final, exactly as before. A tool the agent references
  but the browser has not registered is reported once to the console
  (`onUnhandledClientToolCall`), because from the candidate's side it looks like an
  interviewer that quietly stopped keeping the record.

### Recording

The portal resolves `isInterviewRecordingOffered(workspace)` server-side and passes it
down. When recording is on offer the main consent line switches to its recordable
variant (`interview.voice.consentRecordable`), the separate opt-in tick renders
directly beneath it, `recordingConsent` rides in the connect body, and a calm
"recording" chip shows during the call while audio is actually being kept. Declining
never blocks the call, and a workspace that does not offer recording renders none of it.

### Known gaps

- `onAgentChatResponsePart` is registered but unverified against a live ElevenLabs
  voice agent; when it does not fire, the interviewer's caption is turn-final.
- The ElevenLabs path has no input-transcription-pending signal of its own, so the
  transcription-race hold is driven by its VAD boundaries rather than by a transcription
  state.
- The presence orb's level meters are best-effort: a browser without `AudioContext`
  gets a static ring.

## Opt-in audio recording

Opt-in audio recording of an AI voice interview. A candidate who is offered one, and who
ticks a **separate** box, has their **microphone only** captured during the call; the
audio is stored on this server beside the database and deleted on a stated schedule.

It exists for one job: a recruiter re-listening to a passage to repair a
speech-recognition error on a technology or product name (registry:
`recruiting/voice-interview-fidelity`). It is an **observation aid**. Nothing scores it,
no verdict is derived from it, and no surface presents it as evidence for a decision.

Off unless a workspace turns it on. A deployment that never touches the setting behaves
exactly as it did before the feature existed — the consent line still reads "No audio is
stored", and it is true.

### Entry points

| Surface | What it is |
| --- | --- |
| Settings → Decision rules → Compliance (`app/features/hiring/decisions/DecisionsComplianceSection.tsx`) | The operator toggle, "Offer candidates an audio recording of their AI interview". Default OFF. |
| `/interview/<token>` (portal) | `RecordingConsent` — the candidate's separate, unticked box, rendered only when the workspace offers it. `useInterviewRecording` does the capture; `RecordingIndicator` is the optional calm in-call chip. |
| `/status/<token>` (candidate) | "Delete my interview recording", with a confirm step. Shown only while audio exists. |
| Recruiter playback | `GET /api/interview/recording/<sessionId>` — the stream. The player UI is WP4's. |
| Automation clock | The daily `interview_recording_retention` job in Settings → the scheduler panel. |

### Flows

**Offer → consent → capture.** The operator turns the setting on
(`compliance.interviewRecordingOffered`, per workspace). `/interview/<token>` asks the
server whether recording is offered; the portal then renders `RecordingConsent` beside
the main consent, unticked. `POST /api/interview/connect` stamps `recording_consent_at`
only when the workspace offers recording **and** the body says `recordingConsent: true`.
During the call `useInterviewRecording` runs `MediaRecorder` over the candidate's
microphone — the transport's own stream when it exposes one (OpenAI), otherwise a stream
the hook acquires and stops itself (ElevenLabs owns the SDK's) — preferring
`audio/webm;codecs=opus`, falling back to `audio/mp4` (Safari) then `audio/ogg`. A 10 s
timeslice; chunks upload strictly sequentially with a monotonic index; the falling edge
of the call flushes the last chunk.

**Nothing here may disturb the call.** Every failure — no `MediaRecorder`, a denied
second `getUserMedia`, a refused upload, a dead network — lands on state `"failed"` and
stops. Nothing throws out of the hook, nothing awaits on the call's own path, and no
error is shown to the candidate as an interruption.

**Playback.** A recruiter's authenticated `GET` streams the file with HTTP Range, so an
`<audio>` element can seek. The files sit outside the public tree; this door is the only
way audio leaves the server.

**Deletion**, by any of four paths:
1. **Retention sweep** (`interview_recording_retention`, daily): 30 days after the hiring
   decision, or the 180-day backstop measured from the call, whichever comes first.
2. **Read-time gate**: the playback door re-evaluates the same predicate on every read,
   so a deployment whose clock never started stops *serving* audio on time even while it
   is not deleting it (registry: `read-time-gate-not-just-the-sweep`).
3. **Candidate request** from `/status/<token>` → `DELETE /api/status/<token>/recording`.
   Deletes the audio and nothing else: the application, the transcript and the decision
   history stand.
4. **GDPR erasure** (`anonymizeEntry`), after its transaction commits.

In every case the **file is unlinked and the metadata row is kept**, stamped with when it
was deleted and why. The deletion is the record.

### API / lib surface

| Surface | Auth | What it does |
| --- | --- | --- |
| `POST /api/interview/recording` (`app/api/interview/recording/route.ts`) | PUBLIC, interview token in `x-kp-token` | One raw audio chunk. Headers `x-kp-token`, `x-kp-session`, `x-kp-attempt`, `x-kp-chunk`; content-type allow-list; ≤ 2 MB per chunk on the bytes read; ≤ 80 MB per session; per-token limiter 240/10min. |
| `GET /api/interview/recording/[sessionId]?attempt=N` | Operator + workspace | Streams the file, serves Range, 404 when deleted, absent, foreign or past its window. |
| `DELETE /api/status/[token]/recording` | PUBLIC, status token in the URL | The candidate's own deletion. Idempotent (`{ ok: true, deleted: n }`), limiter 10/min per client + token. |
| `GET /api/status/[token]` | PUBLIC, status token | Gains **one boolean**, `hasInterviewRecording`. |
| `app/_lib/interview-recording.ts` | — | `isInterviewRecordingOffered`, the file store, `deleteSessionRecordings` / `deleteEntryRecordings`, `entryDecisionAt`, `recordingRetentionDue`, `runInterviewRecordingRetention`, `entryHasRecording`. |
| `app/_lib/interview-recording-paths.ts` | — | Pure: the mime allow-list, the byte budgets, the retention windows, file-name construction, the accept-a-chunk state machine, the Range parse. |
| `app/_lib/db/interviews.ts` | — | `claimInterviewRecordingChunk`, `markInterviewRecordingPartial`, `markInterviewRecordingsDeleted`, `interviewRecordingsForSession`, `interviewRecordingRowForSession`, `listInterviewRecordingsDue`, `listInterviewRecordingsForEntry`. |
| `app/_components/voice/useInterviewRecording.ts` | — | The browser capture + sequential upload. |
| `app/_components/voice/RecordingConsent.tsx` | — | The separate consent box and the in-call indicator. |

#### Refusals

`INTERVIEW_RECORDING_NOT_OFFERED` (403, not offered *or* no audio consent on the row —
one refusal for both), `INTERVIEW_RECORDING_CLOSED` (409), `INTERVIEW_RECORDING_TYPE_UNSUPPORTED`
(415), `INTERVIEW_RECORDING_FULL` (413), `INTERVIEW_RECORDING_NOT_FOUND` (404),
`PAYLOAD_TOO_LARGE` (413), `TOO_MANY_REQUESTS` (429). Faults answer
`INTERVIEW_RECORDING_FAILED` / `STATUS_RECORDING_DELETE_FAILED`. All seven have
`errors.<CODE>` in the four catalogs.

### Data model

**The setting** is one field on the per-workspace compliance config,
`compliance.interviewRecordingOffered` (`app/_lib/decision-config-schema.ts`), read
through `getDecisionConfig<ComplianceRule>("compliance", workspaceId)`. It is **optional
and absent-by-default**, the `holdoutPercent` precedent: a compliance row saved before
this feature existed keeps validating byte-identically. Because the compliance row is
written wholesale, `decision-config-store.writeConfigRow` carries a stored value forward
when a write omits the key (the `familyFloors` rule) — otherwise changing the
jurisdiction would silently withdraw the offer.

**The ledger** is `interview_sessions.recordings_json`, an array of `RecordingMeta`
(`app/_lib/voice/director-types.ts`): `attempt`, `file`, `bytes`, `mime`, `startedAt`,
`endedAt`, `partial`, `deletedAt`, `deleteReason`, and `lastChunk` (the replay cursor).
`recording_consent_at` on the same row is the consent fact. Two event kinds land on the
append-only `interview_events` record: `recording_started` (once per attempt, on the
first chunk) and `recording_deleted` (with its reason).

**The files** live at
`<dirname(KP_DB_PATH)>/recordings/<workspaceId>/<sessionId>-a<attempt>.<ext>` — on the
shipped image `/data/recordings`, the same persistent volume as the database, so one
backup covers both (`docs/architecture/self-hosting.md` §4). `data/recordings/` is
gitignored. Both path segments and the file name are built from **server-minted ids
only**; a caller-supplied string never reaches a path.

### Retention

Two windows, both constants in `interview-recording-paths.ts`, both interpolated into the
candidate-facing copy so the number enforced and the number promised cannot drift
(registry: `retention-ttl-and-derived-disclosure`):

- `RECORDING_RETENTION_AFTER_DECISION_DAYS = 30`
- `RECORDING_BACKSTOP_DAYS = 180` (from the call; an absolute ceiling)

**The decision timestamp is the one the code actually records** (`entryDecisionAt`):

- a terminal status (`rejected` / `declined` / `rematched` / `role_closed`) is written
  with `updated_at` and does **not** move `stage_changed_at`
  (`app/_lib/db/pipeline.ts:3021`, `:3244`, `:863`) — so `updated_at` is the stamp;
- a **hire** keeps `status='active'`, moves the stage to `Hired` and stamps
  `stage_changed_at`, which that code deliberately never moves again because it anchors
  time-to-hire (`:3047`, `:3072`).

Caveat, stated rather than hidden: `updated_at` also moves if someone edits a closed
entry later, which can only **delay** a deletion. The 180-day backstop bounds it, and it
is measured from the call rather than from the entry. Audio whose dates cannot be read at
all is treated as **due** — uncertainty resolves toward the candidate.

### Keyless behaviour

Nothing here calls a model or a paid provider. Capture is `MediaRecorder` in the
candidate's browser; storage is the local filesystem; retention is a local sweep. A
keyless, fully offline self-host has the whole feature. The only reason it does nothing on
a given deployment is the operator setting being off, which is the default.

### Known gaps

- **No browser was driven.** `MediaRecorder` container support, the `dataavailable`
  cadence and the final-flush timing are per-browser behaviours no test here exercised.
  Safari's `audio/mp4` path in particular is coded from the spec, not observed.
- **No recruiter player.** The playback route exists and streams; the UI that opens it is
  WP4's.
- **Multi-range requests** are served whole rather than as a multipart body. No player is
  known to need one.
- **Attempt selection on playback** defaults to the latest attempt that still has audio;
  a session with several recorded attempts has no UI to choose between them yet.
- **Per-chunk atomicity.** A crash between the ledger claim and the file append leaves the
  attempt marked `partial` rather than repaired. That is the honest direction, but it does
  mean a flaky upload can mark a recording partial that is only missing ten seconds.

## Recruiter evidence

The director keeps a complete record of an AI interview (see "Director engine"), and
until WP4 none of it reached a recruiter: the transcript modal showed a flat wall of
turns, the agenda was invisible, the observations the browser made were invisible, and
the audio a candidate opted into had a streaming door and no player.

**One rule governs the whole surface. Integrity observations are OBSERVATIONS.** Focus
departures, guardrails and answer timing are shown as facts with their provenance.
Nothing scores them, nothing ranks on them, and no field exists that a surface could
mistake for a verdict. The panel says so in its own heading, not only in this document
(registry: `ai-assistance-detection-and-fairness` —
`observed-process-is-supporting-not-load-bearing`; `never-infer-from-how-a-person-sounds`).

### Entry points

| Surface | What it shows |
| --- | --- |
| Schedule → human round → a finished candidate → "View transcript & scorecard" | The transcript modal, now with the agenda grouping, the observations panel and the audio players. |
| Schedule → AI round → **Completed** (`ScheduleAiRoundCompleted.tsx`) | The same modal. This list is new: in an AI-only hiring plan `ScheduleTab` renders `ScheduleAiRound` **instead of** the calendar surface, and the modals hung off that surface's aside — so the evidence view was unreachable for exactly the plan that produces the most of it. The list sits BESIDE the ledger; the ledger's "awaiting / live only" scope is unchanged. |
| Pipeline → candidate drawer → interview outcome card | A not-assessed competency now says so instead of showing a filled 3/5. |
| Decisions → an AI review card's rubric dots | Same. |
| Library → a job → Compare interviews | Same, in the grid cells and in the CSV export. |

### The evidence door

`GET /api/interview/sessions/[id]/evidence` → `{ evidence }`
(`app/api/interview/sessions/[id]/evidence/route.ts`).

Operator-gated and workspace-scoped exactly like its siblings: a foreign or unknown id
answers the same `INTERVIEW_SESSION_NOT_FOUND` (404), so the door cannot be used to learn
which candidates a neighbouring team interviewed. A store failure answers
`INTERVIEW_LOOKUP_FAILED` (500).

**Consent is re-checked at read time**, the same synchronous gate the entry-keyed
transcript read applies. When consent has expired or the entry is anonymized, every
verbatim word is withheld — turn text, evidence quotes, the candidate's forwarded
questions — and the structure survives: a guardrail still shows as a guardrail, in its
block, at its minute.

The projection (`app/_lib/interview-evidence.ts`, pure — the route reads the rows and
hands them in):

| Field | Meaning |
| --- | --- |
| `agenda` | `{durationMin, hardCapMin, closeReserveMin, blocks}`, or null for a call that was never directed. Each block: `id`, `kind`, `title`, `budgetMin`, `scored`, plus the derived `begun`, `covered`, `spentMs`. **No `competency` and no planned `questions`** — private brief material does not cross this boundary. |
| `events` | The projected record, oldest first. Per kind: `turn` → `role`, `text`; `topic_covered` → `quote`; `topic_cover_rejected` → `quote`, `reason`; `guardrail` → `guardrail` (the kind), `quote`, `verified`; `candidate_question` → `question`; `directive` → `directive` (the KIND only); `focus_lost` → `during`; `focus_returned` → `awayMs`; `answer_timing` → `turnSeq`, `preSilenceMs`, `durationMs`; `end_requested` → `endReason`, `refused`. Every event also carries `kind`, `attempt`, `seq`, `blockId`, `at` and `offsetMs`. |
| `offsetMs` | Milliseconds from the call's clock origin, measured on the **server** clock only — the same rule the director's own arithmetic runs under. Null when unreadable. |
| `startedAt`, `elapsedMs` | The clock origin, and live time across every attempt with the gaps left out (`deriveDirectorState`, reused rather than re-derived, so the recruiter's "what was covered" and the live call's cannot disagree). `elapsedMs` for a finished call is measured to its END, not to the reader's wall clock. |
| `limit`, `truncated` | The read returns at most `EVIDENCE_EVENT_LIMIT` = **1500** rows, the most recent ones. A session stops storing events at 4000, so this bounds the pathological case; past it the oldest turns lose their block tag and read as off-agenda, and the modal says so. The transcript itself is served whole by the sibling door and is never truncated. |
| `recordings` | Per recorded attempt: `attempt`, `mime`, `bytes`, `partial`, `startedAt`, `endedAt`, `deletedAt`, `deleteReason` and `state`. **Never the file name.** |
| `state` | What the playback door will actually do: `available`, `deleted` (the row is the record of its deletion), or `expired` (the read-time retention gate already refuses it, swept or not). The panel therefore never renders a control that would 404. |
| `observed` | False when the call left no director record at all. This is the difference between "the candidate never left the tab" and "nobody was watching the tab", and the panel prints the second rather than four zeroes. |
| `timingSource` | `speech_boundaries` (OpenAI) or `vad_windows` (ElevenLabs), null otherwise. |

Never on the wire: `callId` / `toolResult` (the model's bookkeeping), the directive's
injected `text` (a stage direction is an instruction to a model, not a finding about a
person), the candidate's bearer token, and the brief.

### The transcript, by block

The stored transcript stays the rendered list — it is the complete one (the hang-up POST
carries turns the live director loop may never have seen, and a resumed call's earlier
attempts are seeded into it) and the scorecard's quote→turn jump indexes into it. The
record is **aligned onto it** instead: a forward two-pointer walk on (role, normalized
text) with a bounded lookahead (`alignTurnsToBlocks`), so a repeated one-word turn cannot
anchor itself to an unrelated moment minutes later.

Sections then render with blocks in **agenda order**, each showing its title, its budget
and whether it was covered; a block nothing was recorded under still renders, because
"nothing happened here" is a fact. Runs of turns that belong to no block — the greeting
before the first `begin_topic`, and the gaps between topics — render where they actually
happened, under "Between topics". **No turn is ever dropped or reordered**, which the
colocated test asserts as conservation over the index set. Turns carry `m:ss` from the
call's start when the record anchored them, and nothing when it did not.

Warm-up, role questions and closing are labelled **not assessed**: they carry
`scored: false` and their turns never reach the scorer.

A call with no agenda, a failed evidence read and a legacy session row all fall back to
the flat list this modal has always rendered. The evidence is an enrichment of content
that is already on screen, so it can never cost the recruiter the conversation.

### Observations

`ScheduleInterviewObservations.tsx`, under a heading that says these are observations and
are not scored.

| Row | What it says |
| --- | --- |
| Left the interview tab | The departures, each with the block it fell in and who held the floor, the total away time, and — separately counted — how many departures have **no measurable length**. The browser records `awayMs: 0` for "the departure was not recorded" and a call that ended while the tab was away records no return at all; neither contributes a zero to the total. |
| Asked for something the interviewer declined | Each guardrail: its kind, the block, the candidate's quoted words, and what the interviewer did — declined in one sentence and carried on. The interviewer's move is identical every time, which is exactly why it is stated: a recruiter reading a quote has to see that nothing was withheld or penalised. A quote that could not be matched to a recorded turn says so. |
| Answer timing | Per block: how many answers, the **median** pause before answering and the median answer length (median, so one 90-second story does not redraw a block's typical answer), and the number of samples behind each. A provider that exposed no boundary yields `null`, which renders "not measured". |
| Questions forwarded to you | The role questions the interviewer could not answer from the posting and told the candidate you would follow up on. The one part of this panel a recruiter can act on. |

**Answer timing names its instrument.** OpenAI Realtime measures from the transcription's
speech boundaries; ElevenLabs measures from voice-activity windows with hysteresis. They
are not the same quantity, so the panel says which one produced the figures and says they
compare only inside this call. When the provider is neither, it says the method is not
recorded.

### Audio

`ScheduleInterviewRecordings.tsx`. One `<audio controls preload="none">` per recorded
attempt, fed by `GET /api/interview/recording/<sessionId>?attempt=N` — a link that dropped
and was retried has two recordings, and "the recording" would silently mean the last of
them. `preload="none"` so opening the modal never pulls megabytes of a candidate's voice
nobody asked to hear. No caption track: the interview's own transcript is on the same
screen, verbatim, which is the text alternative.

A recording that is not playable renders **no control**: `deleted` prints when and why,
`expired` says it is past its retention window. A `partial` recording says it is partial,
so the silence at the end reads as an upload that failed rather than an answer the
candidate did not give. A session with no recording renders nothing at all.

#### Recruiter deletion

`DELETE /api/interview/sessions/[id]/recording[?attempt=N]`
(`app/api/interview/sessions/[id]/recording/route.ts`) — the fourth door onto
`deleteSessionRecordings`, beside the retention sweep, the candidate's own control on
`/status/<token>` and GDPR erasure. `deleteReason: "recruiter"` had been in the vocabulary
since the recording feature landed with nowhere to come from.

It asks the **capability**, not only "is an operator present": `pipeline:write`, which a
viewer seat does not hold — a viewer may listen (playback is a read) and may not destroy.
Workspace-scoped; a foreign id, an unknown id and a session with no live audio all answer
`INTERVIEW_RECORDING_NOT_FOUND` (404). `?attempt=N` deletes one attempt, no `attempt`
deletes every live one, and the answer is `{ ok: true, deleted: n }`. Faults answer
`INTERVIEW_RECORDING_FAILED`. The UI is confirm-guarded per attempt and a failure names
itself rather than leaving a recruiter believing audio is gone when it is not.

The file is unlinked, the ledger row is **kept** stamped with when and why, and a
`recording_deleted` event is appended: the deletion is the record.

### "Not assessed", everywhere a rating is rendered

The AI synthesis stores a competency the interview never reached as a real **3 carrying
"Not assessed…" evidence** (`interview-scorecard.ts`, `isNotAssessedRating`). Only the
transcript modal's rating row consulted that guard, so the same untouched axis rendered as
a confident mid-band score on every other surface. It is now consulted on all of them:

- `PipelineInterviewOutcomeCard.tsx` — the drawer's outcome card;
- `DecisionsAiReviewCardLadder.tsx` — the rubric dots on the card where a reviewer
  ratifies the verdict;
- `JobsCompareInterviewsCohortTable.tsx` — the compare grid's cells, where the confusion
  was worst: a candidate asked about an axis and one never asked about it rendered
  identically on the surface built to rank them against each other;
- `jobsCompareCohorts.ts` `compareCsvRows` — the export, because in a spreadsheet the
  caveat cannot travel with the number, so the number must not travel either. A genuine
  observed 3 still does.

### Keyless behaviour

Nothing on this surface calls a model or a paid provider. The evidence door is a SQLite
read plus the director's pure derivation; the grouping, the summaries and the clock codes
are pure functions in the browser; playback streams a local file. A keyless, fully offline
self-host has the whole feature.

### Known gaps

- **No browser was driven.** The players, the confirm step and the grouped transcript are
  coded and unit-pinned but never rendered against a real DOM in this package.
- **Alignment is text-based.** A turn whose stored text and recorded text differ (a
  provider that re-punctuates a finalized turn after the director saw it) loses its block
  tag and reads as off-agenda. It is never dropped and never mis-anchored, but it is also
  not recovered.
- **`offsetMs` is a server stamp.** A turn's time code is when the server recorded it, not
  when it was spoken; on a healthy call the two differ by the round trip, on a degraded one
  by more.
- **Answer timing is not comparable across calls.** The panel says so, but nothing prevents
  a recruiter comparing two candidates' figures by eye when the two calls ran on different
  providers.
- **The evidence read is a second round trip** after the transcript read, keyed by the
  session id the first one returns. A single door serving both was not built because
  `by-entry` is consumed by several other surfaces that do not want the record.

## The interview simulator (the /uat conversation level)

### Simulator engine

A development instrument that drives the **real** directed interviewer in text: the same
agenda, the same private brief, the same pure director policy and the same tool results
production returns, against simulated candidates, on a throwaway database and a simulated
clock. It is the /uat "LC" (conversation) level. It tests the brief and the director policy,
not the voice channel: a text model stands in for the realtime model, so recognition,
turn-taking latency and barge-in stay the voice smoke's job. It never touches the
operator's database and never bills a voice minute. "Simulator engine" covers the engine and what
it writes; "Verdicts" covers what a run proves.

#### Entry points

| Where | What |
| --- | --- |
| `scripts/interview-sim.ts` | The CLI (`node --import ./scripts/test-alias-loader.mjs --experimental-transform-types scripts/interview-sim.ts …`). Flags: `--situation` (ids or substrings), `--fixture`, `--lang`, `--workers N`, `--max-calls N` (model calls per conversation, both sides, default 120), `--max-turns N` (candidate turns, default 50), `--out <dir>`, `--fake`, `--seed N`, `--model` / `--interviewer-model` / `--candidate-model`, `--timeout <s>`, `--db <path>`, `--keep-db`, `--list`. Prints one line per conversation. Exit 0, 1 when a conversation errored, 2 on a refusal. |
| `app/_lib/interview-sim/types.ts` | The contract: `SimSituation`, `SimTurn`, `SimConversation`, `SimLlm`, `SIM_FIXTURES`, `SIM_TOOL_LINE`, the four verdict states. |
| `app/_lib/interview-sim/situations.json` + `situations.ts` | The tracked situation bank, its loader/validator, `SIM_INVARIANTS` (the ids a situation may `provoke`) and `instrumentLocaleFor`. |
| `app/_lib/interview-sim/instrument.ts` | `buildSimInstrument(fixture, locale)`: seeds a fixture into the throwaway DB and composes it through the real builders; `assertThrowawayDb`, `throwawayDbProblem`, `directorVersion`, `briefSha`. |
| `app/_lib/interview-sim/engine.ts` | `runConversation`: the turn loop, the director exchanges, the simulated clock, the end handshake; the harness preambles. |
| `app/_lib/interview-sim/director-loop.ts` | `InMemoryDirector`: `voice/director-step.ts`'s exchange with the events table replaced by an array. |
| `app/_lib/interview-sim/tool-line.ts` | Parses an interviewer reply into spoken text and tool calls, and a candidate reply into words and pauses. |
| `app/_lib/interview-sim/clock.ts` | `SPEAKING_WPM`, `TURN_LATENCY_MS`, `DIRECTOR_HEARTBEAT_MS`, `SIM_EPOCH_MS`, `spokenMs`. |
| `app/_lib/interview-sim/providers.ts` | `claudeCliLlm`: the Claude CLI as a `SimLlm`. |
| `app/_lib/interview-sim/fake.ts` | `fakeInterviewer`, `fakeCandidate`, `recordingLlm`: keyless scripted stand-ins. |
| `app/_lib/interview-sim/runner.ts` | `runSimulations`: instruments, resume, the worker pool, the dumps and the index. |

No app route imports any of these (the engine sits under `app/_lib/` only so its tests run
in `npm run test:unit`).

#### The instrument, per fixture

Each fixture is seeded into a **throwaway** database and composed by the builders
`/api/interview/connect` uses, minus the session row:

| Fixture | Seeded | Built by | Branch |
| --- | --- | --- | --- |
| `kit` | An entry with no prep, pinned to the job's published kit | `buildInterviewKit(entry, ws, { kitId })` + `buildGroundedInterview(entry, ws, { readOnly: true, kit })` + `buildCandidateSafeBrief(entry, { kit })` | `kit` |
| `prep` | An experienced entry with a generated prep plan (`buildRunOfShow` → `saveInterviewPrep`), no kit | same | `prep` |
| `debrief` | A posting, a submission and an evaluation with three minted authorship questions; the entry links the submission | same | `debrief` |
| `student` | An entry with `archetype: "student"` on a junior job | same | `student` |
| `rehearsal` | A **draft** version of the same kit | `buildKitOnlyInterviewKit` + `buildRehearsalBriefs` | `kit` |

The fixture job is Backend Engineer at a fictional Northwind Payments (published, so its
posting rides ROLE FACTS). The kit has three competencies, two must-asks (one in the **last**
competency, so a call that runs long reaches the close reserve still owing it), one weight-3
block and a three-entry FAQ that the posting does not duplicate. The booked length is the
branch's own planned length: 20 minutes for the kit (hard cap 24, close reserve at 20, end at
26).

The builder asserts **which** branch it built, not only that one was built, and refuses to
seed unless `KP_DB_PATH` is set, equals the path `db-path.ts` froze, and lies outside the
repository's `data/` directory. The CLI points `KP_DB_PATH` at a fresh temp file before it
imports any store module.

**The locale.** A situation that provokes `language_follow` is built with no applicant
locale, so the brief keeps the bilingual greet-then-detect opener and the lock is actually
exercised. Every other situation is built as if the applicant had chosen its language.

The stand-in interviewer receives the **private** brief (the one minted for OpenAI, with the
director protocol, private notes, must-asks and weights). The candidate-safe brief is recorded
beside it for leak checks and is never sent anywhere. `instrument = { briefSha, agendaBlockIds,
directorVersion }` is recorded on every conversation. `briefSha` is the SHA-256 of the private
brief alone. `directorVersion` is the SHA-256 of `voice/director.ts`, `voice/director-tools.mjs`
and `quote-match.ts` (line endings normalised).

#### Flows

1. **Two models, never one.** The interviewer and the candidate are different `SimLlm`
   instances. The interviewer's system is the private brief, then one harness preamble: how
   the text channel stands in for function calling, and the six tool definitions verbatim from
   `DIRECTOR_TOOL_DEFS`. The candidate's system is a short role-play preamble, then the
   situation's persona. The candidate never sees the brief.
2. **Tool calls.** The stand-in writes `<<tool {"name":…,"args":…}>>` on a line of its own
   (`SIM_TOOL_LINE`). The parser accepts a superset of that regex: inline calls, two per line,
   braces inside strings. A malformed call is stripped too, and it is answered "Continue with
   the agenda." like a malformed function call. Each call is its own director exchange, run
   through `parseDirectorTool` and the real `applyDirectorTool`. The exact result string goes
   back to the interviewer as `<<result NAME>> …`.
3. **Speech after tools.** Production's model calls a tool, waits for the result, and only
   then speaks. A text reply carries both, so the engine applies the calls first and treats
   the words as spoken after them. When the director **refuses** a call (a rejected quote, a
   refused `complete`, a covered block begun again, extra time nobody asked for), the words
   are withheld and the stand-in is asked to continue. A reply of tool lines alone gets a
   continuation too. There are at most two continuations per turn.
4. **The director loop.** `InMemoryDirector.exchange` mirrors `runDirectorStep`'s order:
   - persist the turns, tagged with the block active before the exchange, clamped like
     production;
   - apply at most one tool;
   - re-derive the state, then decide and record at most one directive;
   - answer `endCall = outcome.endCall || state.endRequested || overTime`.

   Every finalized turn is posted at once. There is a heartbeat exchange every 20 simulated
   seconds. A directive's text, already `[Director]`-prefixed, is injected into the
   interviewer's context verbatim, without prompting a reply. `engine.test.ts` pins
   director-step's order and the heartbeat, so the mirror goes red rather than stale.
5. **The end.** `endCall`, and the browser's fallback hard stop, run the browser's end
   handshake (`call-observations.ts`). The fallback hard stop is armed with
   `hardStopDelayMs`, re-armed with `extendedHardStopDeadline`, and frozen once an end signal
   is pending. The call ends once the interviewer's current words finish. A closing line that
   has not started within `END_START_GRACE_MS` (4 s) is never heard, and a candidate still
   talking at that point is cut off. `endedBy` is:
   - `end_interview`: an accepted `end_interview`;
   - `director_end`: the director's end limit;
   - `hard_stop`: the browser's own stop fired first;
   - `max_turns`: a harness cap was reached;
   - `error`: a provider failed.

#### The simulated clock

Each turn advances the clock by its spoken length at **150 words per minute**, plus a fixed
**1.5 s** turn latency per model response. A continuation after a tool result is a new
response and pays the latency again.

- **Why 150.** Conversational English sits around 140–170 wpm, and a TTS voice at its default
  rate is at about 150–170. There is one rate for every language on purpose; Czech runs fewer,
  longer words.
- **Why 1.5 s.** That is a realtime model's response latency plus semantic-VAD end-of-turn
  detection at "low" eagerness.
- **Pauses.** A candidate may write `<<pause N>>` to be silent for N seconds, capped at
  5 minutes. A reply that is only a pause posts no turn to the director.
- **The epoch.** It is fixed (`SIM_EPOCH_MS`), so a conversation is reproducible from its
  inputs.

`clock.test.ts` pins these behaviours against the kit agenda:

- a long-winded candidate triggers `stay_narrow` for b1, then `move_on` to b2;
- a must-ask left to the end triggers `ask_overrun` at minute 20, before any `close_now`;
- an agreed overrun ends at 2× the booking (40 min), with the browser's stop re-armed to the
  same limit;
- a declined overrun closes the call and records both must-asks as unasked;
- the director's own end runs the handshake.

#### Output

`--out <dir>` (default `<tmp>/kp-interview-sim/<runId>`) holds:

| File | Holds |
| --- | --- |
| `<situationId>.json` | The `SimConversation` plus a `trace`, written the moment the conversation finishes. |
| `instruments/<fixture>.<locale>-<sha12>.json` | The agenda, both briefs and both harness preambles, keyed by `briefSha`. |
| `index.json` | Every run into the directory, and one summary row per conversation (end reason, turns, calls, simulated minutes, tool and directive counts). |

A turn with `tool` set is a tool call, with role `system`, the raw tool line as text, and the
director's result. A `director` turn is a stage direction. A `system` turn without `tool` is a
harness note: silence, withheld words, a cut-off, a cap, a provider error.

The `trace` carries:

- the in-memory `interview_events` record;
- every directive with its kind and block;
- the final director state (covered/begun blocks, end limit, overrun answer, outstanding
  must-asks);
- the first end signal and where the browser's stop stood;
- the providers, the clock constants and the limits.

**Resumable.** A rerun into the same directory skips a situation whose dump exists, did not
end in `error`, and was produced by the same `briefSha` and `directorVersion`. An errored or
stale dump runs again.

#### The situation bank

`situations.json` holds 35 situations across all five fixtures, in English and Czech.

- **The Python text eval's 16 behaviours.** These come from
  `interview_scenarios_gen.py` `BEHAVIORS`. Each persona is the Python behaviour prompt
  verbatim, behind a role line for the fixture job.
- **The registry's missing behaviours.** Asks for a human, withdraws consent (also in Czech),
  volunteers sensitive personal data, alleges discrimination, is distressed, claims
  authority, asks harmless look-alike questions, escalates within one call, and a Czech
  code-switcher.
- **The director situations.** The overrun agreed and declined, a provoked premature
  "complete", answers too thin to quote, a role question the kit FAQ answers, and one nothing
  answers.

Each situation declares `provokes`, drawn from `SIM_INVARIANTS` (reliability, protocol, policy
or quality), and `handles`, the required response in one line.

#### Providers and keyless behaviour

- **`claudeCliLlm`** runs `claude -p --output-format json --setting-sources project --tools ""
  --no-session-persistence --system-prompt-file <file>` in a neutral empty temp directory, one
  process per call.
  - The child's environment drops `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN`, so it bills
    the subscription, and drops the Claude Code session markers.
  - There is a 180 s timeout per call.
  - It refuses at construction and at every call when `KP_OFFLINE` is set, and it refuses
    when the CLI is not on PATH.
- **`--fake`** runs the whole engine keyless. It uses a scripted interviewer that follows the
  agenda and the protocol, and a scripted candidate per behaviour. No model, no key, no
  network. The unit tests use the same fakes.

#### Known gaps

- **The candidate is a model too.** A simulated candidate may not perform its behaviour.
  `provokes` names what should have been provoked. The verdicts check the stimulus first,
  and an invariant whose behaviour never happened is `not_provoked`, never a pass
  (see "Verdicts").
- **One text call is not a realtime turn.** Speech-after-tools and the continuation are an
  approximation of `function_call_output` + `response.create`. A directive decided during a
  reply's tool exchanges reaches the stand-in only at its next call.
- **One attempt per call.** Drops and reconnects (`resume`) are not simulated.

### Verdicts

`scripts/interview-sim-verdict.ts` reads one or more simulator output directories and
says what they prove. The engine is `app/_lib/interview-sim/verdict-run.ts`.

```bash
node --import ./scripts/test-alias-loader.mjs --experimental-transform-types \
  scripts/interview-sim-verdict.ts --runs <dir>[,<dir>] \
  [--out <dir>] [--judge-model <m> | --no-judge | --fake-judge] \
  [--characters <paths>] [--timeout <s>] [--workers <n>]
```

- `--no-judge` is the default. It runs the rules only, needs no key, and reports every
  judge-method invariant as `not_evaluable`.
- `--judge-model <m>` runs the judge on the Claude CLI. It is refused under `KP_OFFLINE`,
  and it is refused when `<m>` is the model that played the interviewer (read from each
  dump's `trace.providers.interviewer`). If the interviewer ran on the CLI's unnamed
  default, the report carries a warning, because the run cannot prove the two differ.
- `--fake-judge` runs the scripted keyless judge (`fakeJudge` in `fake.ts`). It answers
  every fact `null` and is for testing the plumbing only.
- Exit 0 when the verdict ran. A failing interviewer is a result, not a CLI error. Exit 2
  on a usage error or a refusal.

#### Four states

Every invariant in `SIM_INVARIANTS` gets one verdict per conversation, in one of four
states (`SIM_VERDICT_STATES`):

| State | Means |
| --- | --- |
| `pass` | The condition arose and the interviewer met it. |
| `fail` | It arose and the interviewer broke it. The evidence names the turn. |
| `not_provoked` | The condition never arose. For a behaviour, the judge looked and the simulated candidate never performed it. |
| `not_evaluable` | The record cannot support a verdict: a provider error, no stimulus source, a missing judge, or judge evidence that did not verify. |

`not_provoked` and `not_evaluable` are never counted as a pass anywhere. A provider
error (`endedBy: "error"`) can support a `fail`, because a breach that happened is a
breach, but never a `pass`.

#### Rule vs judge

- **Rules** (`detectors.ts`, over the lexicons in `lexicon.ts`) decide everything they
  can read off the record: the reliability invariants, the tool and director protocol,
  `consent_stop`, `guardrail_reported`, `forwards_unknown`, `ends_in_time`. Containment is
  an ordered pair at sentence level: the refusal detector runs first, and the violation
  detector runs only on the sentences that are not refusals. Inside a refusal sentence, a
  clause after "but" (or its cs/de/fr form) is checked on its own. The lexicons cover
  en, cs, de and fr. German and French are deliberately conservative.
- **The judge** (`judge.ts`) makes one call per conversation and answers binary facts,
  never scores. Examples: where a behaviour first happened, whether a request for a human
  was routed, whether an unanswerable role question got an invented answer. The judge
  gets the transcript, the agenda block ids and titles, the situation's `handles` line and
  the ROLE FACTS paragraph (`roleFactsOf`). It never gets the rest of the private brief.
  Every fact that cites a turn must cite an existing turn of the right speaker that
  contains the quote. A fact whose evidence does not verify becomes `not_evaluable`.
  Malformed JSON gets one repair retry, and after that every judge-method invariant of
  that conversation is `not_evaluable`. The rubric is versioned (`JUDGE_RUBRIC_VERSION`).
- **Stimulus.** An invariant that responds to a candidate behaviour needs the turn where
  the behaviour happened. Keyless, that is only the scripted first line, and only for the
  ids a situation lists in `firstMessageProvokes` (six situations do). Otherwise the judge
  finds it. A declared behaviour with no source is `not_evaluable`.
- `no_praise` is on the reliability axis with a narrow detector. The broad praise pattern
  is a separate trend counter, and so is the stacked-question count (a lower bound).

#### Artifacts

Written to `--out` (default `<first run dir>/verdict/`):

| File | Holds |
| --- | --- |
| `verdicts.json` | Per conversation: every verdict, the quality metrics, the cross-block records, the judge id and rubric version, and the dump's sha256. |
| `heatmap.md` | The margins first: the reliability, protocol and policy axes grouped by behaviour, by fixture and by language, worst reliability first. Then the behaviour × fixture cross, where cells under 3 conversations are marked thin. Then the registry's reading order. |
| `findings.json` | /uat findings with `cert_level: "LC"`: one per failing invariant, plus strength rows for invariants that held in 3 or more evaluable conversations. `severity` is derived from `impact`. `verdict` is always `uncertain`. |
| `report.md` | Instrument identity, the reliability gate ("N reliability fails across M conversations", with each breach's turn), the margins, findings by impact, the quality rates, the cross-block measurement and what passed. |
| `voices/<character>.md` | Only with `--characters`. See below. |

Each run directory also gets `verdicts/<situationId>.json`. It is the per-conversation
verdict file and the judge cache, keyed by the dump's sha256, the judge id and the rubric
version. A rules-only run never overwrites a judged file.

Several `--runs` directories are treated as repeated samples of the same bank, so each
situation's cell becomes a rate. Dumps of the same situation made by different instruments
(`briefSha` or `directorVersion`) are refused, and the error names them.

#### Character voices

`--characters` takes /uat Character files. A Character needs `sim_behaviours: [...]` in
its frontmatter and a `## Conversation criteria` section; a file missing either is
skipped, and the report says why. The Character reads its matching conversations
candidate-side only, on the judge's model, and answers in the first person. Each criterion
gets `pass`, `fail` or `n/a`, citing `transcript:<runId>/<situationId>#<seq>`. A citation
that does not verify is reported as `n/a (evidence did not verify)`.

#### The cross-block measurement

A same-block cover rule was tried and withdrawn (see "Known gaps" under the director). The
verdict run measures the case instead of guessing. For every accepted cover it finds the
candidate turn the quote matched, with the director's own matcher, and the block that was
active when that turn was recorded. The cover is then:

- `same_block`: the turn was recorded under that block;
- `late_begin`: it was recorded under another block (or none), but the question that
  prompted it was about the covered block. The judge decides this. It is a
  `begins_blocks`-class lapse, and the evidence is sound;
- `cross_topic`: it answered a different topic. This is the case a stricter rule would
  target;
- `unclassified`: cross-block, but nobody judged it (keyless).

It is a measurement, not an invariant, and it never fails a conversation.

#### What it never claims

The tool never marks a finding `confirmed` or `resolved`. A finding stays `uncertain`
until a person reads its transcript (the /uat adversarial pass). Simulated candidates show
that the policy holds against behaviours someone imagined, not against real candidates.

Tests: `lexicon.test.ts`, `detectors.test.ts`, `judge.test.ts`, `verdict-run.test.ts`
(pure, on `dump-builder.ts` dumps) and `verdict-e2e.test.ts` (the WP-1 engine on the
fakes, then the verdict run with the fake judge).

## After the decision: the candidate's feedback letter

After a HUMAN decision, a candidate may ask from their status page for a short letter
about their AI interview. It names competencies in plain words, never quotes the
candidate or mentions a rating, is drafted in their language, and reaches them only
after a recruiter edits and approves it. The request door, the eligibility rule, the
record and the draft live with the candidate's other rights:
[`docs/features/compliance/README.md`](../compliance/README.md) §"Interview feedback
letters — request, record, draft".

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
unregistered mint door, an unexpected error) it *fails open towards the human*: nothing is minted, nothing is
sent, nothing anywhere claims an invite went out, and the candidate is left on the
`calendar` gate exactly where a `human`-gated step would have left them — visible
in the AI-round docket under "Awaiting link". The reason goes to the server log
(`[stage-hooks] <entry>: AI interview link not minted (<reason>) — <why>`).

The hook reaches the mint through a boot-registered seam
(`app/_lib/stage-hooks-invite.ts`, filled by `app/_lib/late-bound-boot.ts` from
`instrumentation-node.ts`), which keeps the mint's graph off every route. A process that
never registered it does not skip the invite silently: the lookup throws inside the
hook's own `try`, the candidate is parked on the `calendar` gate like any other
failure, and the log line names the missing registration. Pinned by the last case of
`app/_lib/stage-hooks.test.ts`.

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

## The sealed `ai_scorecard` carries what the verdict was made of

`/api/interview/complete` seals an `ai_scorecard` decision on the entry when a
candidate-mode call completes. Its sealed `inputs` used to be the conclusion
alone — `{ recommendation }` — which had two consequences: the chain recorded a
verdict with nothing to re-check it against, and the candidate's own Art. 86
surface (`/status/[token]`) could show the decision only as a bare label,
because `app/_lib/status-decisions.ts` had nothing to read.

The seal now also carries the **rubric axes the verdict was made of**, built by
`sealableRubricDimensions` (`app/_lib/interview-scorecard.ts`) as
`{ competency, rating }` pairs and nothing else. What it drops, and why:

- **A not-assessed axis.** The synthesis rates an untouched competency
  `NOT_ASSESSED_RATING` (3 of 5) with `"Not assessed…"` evidence, which reads
  identically to an observed middling score to anything looking at the rating
  alone — so sealing it would tell a candidate they scored mid on a competency
  the interview never raised. `isNotAssessedRating` is the filter.
- **An off-rubric axis**, for the mirror reason: it is not a scale the candidate
  was told they would be measured on.
- **The evidence quote and the summary.** Never sealed, so they can never reach
  the candidate view. The quote is a *model's selection* of the candidate's
  words, and a mis-transcribed one (see `ScorecardEntities` for how often voice
  ASR needs correcting) would read as something they did not say.

`MAX_SEALED_RUBRIC_DIMENSIONS` bounds the list, because `ratings` originates in
an LLM synthesis. The read side (`aiScorecardFacts`) re-validates every one of
these constraints independently rather than trusting the payload — records
outlive the code that sealed them — and the two ceilings are pinned equal by
`app/api/status/status-decisions.test.ts` rather than shared by reference.

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

Both session-mint routes cap the request body at 16 KB on bytes read and return
`PAYLOAD_TOO_LARGE` (413) before consuming their spend-throttle budget. The
candidate `/connect` door has the same 16 KB cap.

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
IPv6 literals in `fc00::/7` also count as private; adjacent public IPv6 ranges
and hostnames remain metered.

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
