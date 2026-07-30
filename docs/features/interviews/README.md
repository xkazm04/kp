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
   `VoiceInterviewClient.tsx`, `InterviewSidebar.tsx`) drives either adapter,
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
   grounded prep-chronology brief from a pipeline entry.

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
| `app/_lib/interview-reminders.ts`, `interview-reminder-policy.ts` | Scheduling reminders |
| `app/_components/voice/VoiceInterview.tsx` | The live-call UI |

## Data model

- Interview sessions (token, provider, mode, status) — `app/_lib/db` (`createInterviewSession`, `getInterviewSessionByToken`, etc.)
- Transcript + scorecard rows, linked to a pipeline entry when candidate-mode
- `llm_usage` ledger rows for voice minutes (`interview_realtime` use case)

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
