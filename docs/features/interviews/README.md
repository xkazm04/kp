# Voice Interview — AI-led first-round screening

An in-browser, voice-driven first-round interview. A candidate opens a
tokenized link, talks to an AI interviewer in real time, and the transcript
feeds scoring/scorecard and the pipeline. Two swappable realtime providers
back the same UI and consent/telemetry pipeline: **OpenAI Realtime** and
**ElevenLabs Agents** (which can also point at a self-hosted, no-per-minute
voice service — see [Self-hosted voice](#self-hosted-voice)).

## Entry points

- Candidate portal: `app/interview/[token]/page.tsx` (+ `error.tsx`,
  `loading.tsx`) — the real, token-bound candidate flow.
- Recruiter dev/demo harness: `app/interview-lab/page.tsx` — a keyless lab for
  trying the agent as a recruiter would; gated by `INTERVIEW_LAB_ENABLED=1`
  outside production.
- Recruiter-triggered simulation: `app/features/tools/interview/InterviewSimTab.tsx`,
  `InterviewStartPanel.tsx`, `InterviewModeCards.tsx`,
  `InterviewAttachToCandidate.tsx` → `app/api/interview/simulate/route.ts`.

## Flows

1. **Session creation.** A real candidate session is minted via
   `app/api/interview/create/route.ts` (entry-backed, `mode="candidate"`,
   produces a scorecard on completion). A recruiter demo/simulation goes
   through `app/api/interview/simulate/route.ts` (`mode: "student" |
   "student-case" | "regular"` picks the brief and run-of-show); both are
   billing-metered the same way (`interview_minutes`).
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
3. **Live call.** `app/_components/voice/VoiceInterview.tsx` (+
   `VoiceInterviewClient.tsx`, `InterviewSidebar.tsx`) drives either adapter —
   the two realtime transports live side by side under
   `app/_components/voice/transport/` (`openai.ts` raw WebRTC, `elevenlabs.ts`
   the SDK hook) while the component keeps the shared shell (phase, consent,
   transcript, finalize). It
   sends `overrides.agent.language` (candidate locale) to ElevenLabs so the
   agent doesn't default to its Czech dashboard language, shows a live
   speaking/listening indicator for both providers, recovers from a
   transient network drop without freezing the mic, and offers a pre-call mic
   test.
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

## Surface

| Path | Role |
|---|---|
| `app/api/interview/connect/route.ts` | Mints provider credentials + brief override |
| `app/api/interview/create/route.ts` | Creates a real candidate session |
| `app/api/interview/complete/route.ts` | Persists transcript, status, usage, scorecard |
| `app/api/interview/simulate/route.ts` + `attach/route.ts` | Recruiter demo/simulation sessions |
| `app/api/interview/revoke/route.ts`, `by-entry/route.ts`, `compare/route.ts` | Session management + cross-interview compare |
| `app/api/interview-prep/route.ts`, `.../scorecard/route.ts` | Prep chronology + scorecard read APIs |
| `app/_lib/voice/index.ts` | Adapter registry, default-provider policy, candidate-safe default brief |
| `app/_lib/voice/elevenlabs.ts`, `openai.ts` | The two provider adapters |
| `app/_lib/voice/self-hosted.ts` | Self-hosted ElevenLabs-compatible endpoint detection (see below) |
| `app/_lib/voice/connect-failover.ts`, `preflight.ts` | Provider failover + pre-connect capability checks (only a **connect** triggers a failover — a failing prompt build surfaces as itself, never as a second mint on the other provider) |
| `app/_lib/voice/candidate-brief.ts` | The client-sent ElevenLabs brief's security boundary: allow-list sanitizers + `candidateSafeTopic` |
| `app/_lib/voice/minute-prices.ts` | Per-minute cost estimates for the usage ledger |
| `app/_lib/interview-scorecard.ts`, `interview-telemetry.ts`, `interview-transcript.ts` | Post-call scoring + telemetry |
| `app/_lib/interview-rubric.ts` | The scorecard rubric resolved from `pipeline/jobfit/interview-rubrics.json` (base axes by scoring model + industry axes by role family), its version hash, and `rubricCoverage` (below) |
| `app/_lib/interview-prep-run.ts` | Builds the prep pack (run-of-show + checklist) and stamps its provenance |
| `app/_components/RubricCoverageNote.tsx` | The shared rubric-coverage disclosure, rendered by the prep pack header and the human scorecard form |
| `app/_lib/interview-reminders.ts`, `interview-reminder-policy.ts` | Scheduling reminders |
| `app/_components/voice/VoiceInterview.tsx` | The live-call shell — phase, consent, finalize/beacon, and the call controls |
| `app/_components/voice/transport/openai.ts` | OpenAI Realtime over raw WebRTC: connection setup, the H3 speaking meter, the H4 drop debounce, teardown, and the transcript-buffer half of the wire protocol |
| `app/_components/voice/transport/elevenlabs.ts` | The `@elevenlabs/react` SDK path: `useConversation` wiring and the agent prompt/language overrides |
| `app/_components/voice/useTranscriptPersistence.ts` | POST-with-retries to `/api/interview/complete`, the sessionStorage stash, and the online/visibility re-drive |
| `app/_components/voice/useMicTest.ts` | The pre-call mic test (stream, analyser, level, verdict) |
| `app/_components/voice/micErrorText.ts` | getUserMedia failure → actionable recovery copy |
| `app/_components/voice/VoiceSettings.tsx`, `MicTestPanel.tsx`, `VoiceLiveControls.tsx`, `VoiceStatusPill.tsx`, `VoiceTranscript.tsx` | The view's leaf components (lab-only pickers, mic-test panel, live-call controls, status pill, transcript log) |

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

The disclosure renders in **both** places a recruiter meets the rubric — the prep
pack header (`ScheduleInterviewPrepHeader`) and the human scorecard form
(`ScheduleHumanScorecardForm`) — through one component,
`app/_components/RubricCoverageNote.tsx`, translated in all four locales under the
`rubricCoverage` message namespace. The `gap` is **persisted for all three cases**
— on the prep payload (a generator-owned key, `interview-prep-run.ts`) and on the
stored human `Scorecard` beside `rubricVersion`/`rubricKeys` — so the record stays
complete even where the UI stays quiet.

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

**Not covered yet:** the AI-synthesized scorecard written by the Python scorer
(`pipeline/jobfit/automation.py`, which mirrors `industry_axes_for`) carries no
`rubricCoverage` stamp — the field is optional and consumers must treat it as
absent there.

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

## Keyless / degraded behavior

- With no provider keys configured, `voiceAvailability()` reports both
  providers unavailable and the connect route surfaces
  `missingVoiceEnv`/candidate-safe failure copy instead of erroring raw.
- The **Free plan includes 0 `interview_minutes`** (`app/_lib/billing/plans.ts`)
  — candidate-mode and simulation sessions both go through `meterGate` and are
  blocked (402) without a paid plan or credits.
- The interview-lab dev harness path is disabled in production by default
  (`INTERVIEW_LAB_ENABLED`).

## Known gaps

- **The candidate portal renders the raw run-of-show.**
  `app/interview/[token]/page.tsx` passes `session.runOfShow` straight into
  `InterviewSidebar`, and those strings are the unsanitized chronology topics —
  the same ones `/api/interview/complete`'s projection strips and
  `candidateSafeTopic()` now scrubs on the ElevenLabs path. A prep pack whose
  competency reads `"Test automation fundamentals (missing must-have)"` shows
  that gap verdict to the candidate in the agenda. Fix: route the stored
  `runOfShow` (or the portal's render of it) through `candidateSafeTopic`.
- **Failover can cross the free→paid boundary with no reservation behind it.**
  `app/api/interview/simulate/route.ts` deliberately skips the
  `interview_minutes` gate when the ElevenLabs base URL is a self-hosted
  (loopback/private) service, and `/api/interview/connect` raises the per-token
  connect throttle to 120/10 min on the same premise — but it reads
  `isSelfHostedVoice()` (an env fact) *before* the session's provider is
  resolved, so an **OpenAI** session on an install that also runs a local voice
  service gets the 120/10 min budget on a fully paid credential mint. The check
  it wants is `isSelfHostedProvider(provider)`, which requires moving the
  throttle below provider resolution. If the local service is
  down, `connectWithFailover` retries on **OpenAI Realtime** — real money — and
  `setInterviewSessionProvider` flips the session, so `/complete` debits the
  meter and stamps the paid per-minute cost for a call no gate ever checked.
  The seam already reports the crossing (`FailoverResult.provider` is the
  provider that actually served, plus `failedOver`); the decision belongs in
  the route — e.g. pass `availability: { ...voiceAvailability(), openai: false }`
  when the preferred provider is the self-hosted one, or run the skipped
  `meterGate` before accepting the paid alternate.
- **Self-hosted minutes are gate-skipped but still debited.** `/simulate` skips
  `meterGate` for a self-hosted provider ("metering a free simulation would make
  a self-hosted install run out of a budget it is not consuming"), but
  `/api/interview/complete` calls `recordMeterUsage("interview_minutes", …)`
  unconditionally — so the quota is consumed without ever being reserved, and a
  self-hosted install burns prepaid minutes on calls that cost nothing.
  `voiceMinuteCostUsd` already returns `0` for those sessions; the meter debit
  needs the symmetric `isSelfHostedProvider(session.provider)` check.
- ASR can corrupt technology terms in transcripts (a "low WER, high semantic
  damage" failure — a spoken skill can be silently substituted for another
  before the scorecard scores it). A static agent-level `asr.keywords` bias
  fix exists in `scripts/setup-eleven-agent.mjs` but requires recreating the
  ElevenLabs agent (a deploy step) and was not yet run as of the last sweep.
- Per-session (per-job) `asr.keywords` biasing is blocked — the
  `@elevenlabs/react` SDK's override type has no `asr` field.
- Sub-specialty language drift and a handful of interviewer-persona
  refinements (praise suppression, one-question-at-a-time, terse-candidate
  drawing-out) are tracked as ongoing prompt tuning, not code gaps — see
  [`docs/development/voice-interview-testing.md`](../../development/voice-interview-testing.md)
  for the eval harness that measures them.

## Testing / evaluation

The interviewer prompt is hardened by a dedicated text+voice eval harness —
see [`docs/development/voice-interview-testing.md`](../../development/voice-interview-testing.md).
