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
| `app/_lib/voice/connect-failover.ts`, `preflight.ts` | Provider failover + pre-connect capability checks |
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
