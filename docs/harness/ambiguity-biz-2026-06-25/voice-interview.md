# Voice Interview — Ambiguity 🌀 + Business 🚀 scan
> Total: 5 | Lens: 🌀3 / 🚀2 | Severity: C1/H2/M2/L0

## 1. whisper-1 is hardcoded, so the "final answer still in flight" recovery is dead code — the candidate's most decision-relevant closing answer can be silently dropped from the scored transcript
- **Lens**: 🌀 Ambiguity
- **Severity**: Critical
- **Category**: edge case / silent data loss / hidden assumption
- **File**: app/_lib/voice/openai.ts:98
- **Observation**: The model and voice are env-overridable (`OPENAI_REALTIME_MODEL`, `OPENAI_REALTIME_VOICE`, openai.ts:8–9), but the input transcription model is hardcoded `transcription: { model: "whisper-1" }`. The code's own comments (openai.ts:24–27) note whisper-1 *only* emits the final `.completed` event and never streams `.delta`s. The finalize path for a candidate utterance that is still pending at hang-up (VoiceInterview.tsx:242–263) waits `OAI_FINAL_TURN_GRACE_MS = 2000` (VoiceInterview.tsx:52) for the `.completed`, then "falls back to whatever streamed into the delta buffer" — `candBuf`. But `candBuf` is fed only by `candidateDelta`/`inputTranscriptionDelta` (VoiceInterview.tsx:393–394), which whisper-1 never emits. So the documented fallback is *provably empty* for the only configured transcription model: if whisper takes >2s on a longer closing answer, that turn is dropped entirely.
- **Why it matters**: The code comment itself calls this final turn "often most decision-relevant" (VoiceInterview.tsx:236–238). It feeds `runInterviewScorecard` → the `scorecard_review` approval that gates Interview→Offer. A closing answer dropped on a >2s whisper turnaround = the scorecard scores an incomplete conversation and a recruiter can advance/hold/reject on missing evidence — a silent wrong hiring outcome, with no log and no marker.
- **Recommendation**: Make the transcription model env-overridable (e.g. `OPENAI_REALTIME_TRANSCRIPTION_MODEL`, defaulting to a streaming model like `gpt-4o-transcribe` so `candBuf` actually populates and the fallback becomes real), OR raise `OAI_FINAL_TURN_GRACE_MS` and document why 2000ms was deemed sufficient for whisper. At minimum, log when the grace expires with `candBuf` empty so the silent drop is observable.
- **Effort**: S

## 2. Per-interview behavioral telemetry is computed and persisted on every scorecard but surfaced nowhere — a built-but-unwired premium analytics / differentiation capability
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: dark capability / value left on the table
- **File**: app/_lib/interview-run.ts:282
- **Observation**: Every completed interview attaches `result.telemetry = extractTelemetry(transcript, …)` to the scorecard. `interview-telemetry.ts` produces talk ratio, duration, the longest interviewer→candidate gap (explicitly a "time-to-recovery proxy … signal the scorecard can't see", interview-telemetry.ts:26), and scripted-hint uptake (`integrated`/`acknowledged`/`missed`, lines 28–39). Grep of `app/features` shows **no UI ever reads `scorecard.telemetry`** — the only reference in the whole app is the writer at interview-run.ts:282. `CompareInterviews.tsx` surfaces `observedSkills` but not telemetry; the compare API doesn't return it.
- **Why it matters**: This is exactly kp's known "dark capability" pattern. The module's stated purpose — validating `potential_score` weights against outcomes and exposing behavioral signals the LLM scorer cannot — is unrealizable while recruiters never see the numbers. Objective, deterministic interview metrics (coachability uptake, talk balance, recovery time) are a concrete competitive differentiator vs. transcript-only screeners and a natural premium "interview analytics" upsell on a feature that already carries real per-minute cost.
- **Recommendation**: Render telemetry in the scorecard/transcript modal and as a column/cohort axis in `CompareInterviews.tsx`; aggregate it into a per-job analytics rollup. Even a read-only "Signals" panel unlocks the differentiation the data already pays for.
- **Effort**: S–M

## 3. Mid-session drop forces a full restart, not a resume — a network blip at minute 25 of a 30-minute grounded screen makes the candidate re-answer everything
- **Lens**: 🌀 Ambiguity
- **Severity**: High
- **Category**: unhandled edge case / happy-path-only / undocumented trade-off
- **File**: app/_components/voice/VoiceInterview.tsx:489
- **Observation**: A dropped/errored call finalizes as `"failed"`, which is intentionally left reconnectable (finalize-status.ts:34–37, connect/route.ts:69). But "reconnect" is a brand-new session: `start()` clears `turnsRef`/`turns` to `[]` (VoiceInterview.tsx:489) and `/connect` mints fresh instructions with no memory of the prior partial conversation. The agent has no continuity; the candidate starts the run-of-show over from question 1. For the grounded screen this is 15–30 minutes (GROUNDED_DEFAULT_MIN=20, interview-duration.mjs:29) of redone work. Nowhere is this "drop = restart, not resume" behavior documented or surfaced to the candidate.
- **Why it matters**: First-round voice screens drop for mundane reasons (wifi, webview, tab switch). Forcing a full redo on a 20–30 min interview is a serious candidate-experience and completion-rate hit on the product's flagship feature, and it's a hidden assumption ("MVP = no resume") that no comment records. Abandoned restarts depress the very scorecard funnel the feature exists to feed.
- **Recommendation**: At minimum document the no-resume limitation beside the failed-is-reconnectable logic and warn the candidate the call restarts. Better: persist partial turns and seed the reconnect's instructions with "resume from topic N" so the agent continues rather than repeats.
- **Effort**: M (document: S)

## 4. Billing meters a single provider-blind `interview_minutes` rate, but the two switchable providers have materially different per-minute COGS and there's no per-call cost attribution
- **Lens**: 🚀 Business
- **Severity**: Medium
- **Category**: monetization / margin risk / undocumented trade-off
- **File**: app/api/interview/complete/route.ts:143
- **Observation**: `recordMeterUsage("interview_minutes", …)` debits one flat per-minute meter regardless of whether the call ran on OpenAI Realtime or ElevenLabs (the per-session provider, types.ts:6, switchable in the lab). OpenAI Realtime audio and ElevenLabs Conversational AI have meaningfully different unit costs, yet nothing captures *which* provider a billed minute ran on or what it cost. The clamp `Math.min(Math.max(elapsedMin,1), bookedMin*2)` caps a runaway call but not the COGS mix.
- **Why it matters**: The provider A/B harness (interview-lab) exists precisely to choose between the two, but with no cost attribution the choice can only be made on subjective quality, not margin. A flat customer price over provider-variable COGS is an unhedged margin exposure as volume scales, and the trade-off is recorded nowhere.
- **Recommendation**: Record provider (and ideally a cost estimate) on each metered usage row so margin-by-provider is reportable; feed it back into the lab's A/B decision; consider provider-aware pricing or a cost-based default-provider policy in `pickDefaultProvider`.
- **Effort**: M

## 5. Billing's booked-minutes fallback uses a magic `?? 8` that bypasses the dedicated single-source-of-truth duration module
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: magic number / inconsistency with documented policy
- **File**: app/api/interview/complete/route.ts:144
- **Observation**: `const bookedMin = session.durationMin ?? 8;` introduces a bare `8` that is neither `QUICK_SCREEN_MIN` (5) nor `GROUNDED_DEFAULT_MIN` (20) from interview-duration.mjs — the module whose entire stated reason for existing is that "Four numbers used to disagree" about interview length (interview-duration.mjs:1–7). This `8` directly drives billing: it is both the no-start-timestamp fallback (`elapsedMin = … bookedMin`) and the per-call clamp ceiling (`bookedMin * 2` → 16 min) at lines 145–147.
- **Why it matters**: A legacy/missing-duration session is billed against an undocumented constant with no recorded reasoning, re-creating exactly the scattered-magic-number drift the duration module was built to eliminate. It is a small but real correctness/clarity gap on the money path.
- **Recommendation**: Import the canonical fallback (e.g. `QUICK_SCREEN_MIN` for an ungrounded/unknown session, or `GROUNDED_DEFAULT_MIN`) instead of `8`, or define a named `BILLING_FALLBACK_MIN` in interview-duration.mjs with a one-line rationale so the value is single-sourced and explained.
- **Effort**: S
