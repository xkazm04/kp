# Voice Interview — bug-hunter + ui-perfectionist scan

> Context: In-browser voice first-round interview with an AI agent (OpenAI Realtime / ElevenLabs switcher): create, connect, run, transcribe, and complete the session.
> Files reviewed: 13 of 31
> Total: 5

## 1. Interview-minute gate reserves 20 min but /complete debits up to 2× the run-of-show length — un-funded overage on the priciest meter

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: validation-gap / money
- **File**: `app/api/interview/complete/route.ts:145-163`, `app/api/interview/create/route.ts:30-31`, `app/_lib/billing/enforce.ts:38-62`
- **Scenario**: A workspace has exactly 20 `interview_minutes` left. `/create` gates with `meterGate("interview_minutes", { minUnits: GROUNDED_DEFAULT_MIN })` — 20 — and passes. The grounded run-of-show carried `durationMin: 30` (the `[15,30]` band; `GROUNDED_MAX_MIN` in `interview-duration.mjs:33`). The candidate takes ~40 wall-clock minutes. At `/complete`: `billedMin = Math.min(Math.max(elapsedMin,1), bookedMin*2)` = `min(40, 60)` = **40**, so `recordMeterUsage("interview_minutes", 40)` drives the meter to **−20**. Even a *default* 20-min interview that merely runs long bills up to 40 against a 20-min reservation.
- **Root cause**: The gate reserves a **constant** (`GROUNDED_DEFAULT_MIN`), but the debit clamps to the **session's** `durationMin*2`. `meterGate`'s own docstring (`enforce.ts:38-46`) says the debit is "up to 2× … the un-funded overage lands as billing_usage on the most expensive meter" — yet the caller gates on 1× the *default*, not 2× the *actual* booked ceiling. The fix that closed the `>0` hole under-reserved.
- **Impact**: Real, reachable money leak — `billing_usage` on the one meter with per-unit cost goes negative near quota, exactly when it matters. Bounded (2× clamp), but every near-cap interview can silently double its reservation.
- **Fix sketch**: Gate with the same ceiling the debit uses: `minUnits: (grounded.durationMin ?? GROUNDED_DEFAULT_MIN) * 2` (compute `grounded` before the gate, or gate on `GROUNDED_MAX_MIN*2`). Single-source the "max billable minutes for a session" so gate and debit read one function — the class of bug is gate/debit reading different numbers.

## 2. A mid-call network drop marks an otherwise-complete interview "failed", so its full transcript is never scored

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure / state-corruption
- **File**: `app/_components/voice/VoiceInterview.tsx:613-618`, `app/_lib/voice/finalize-status.ts:34-37`, `app/api/interview/complete/route.ts:145,174`
- **Scenario**: A candidate answers every question of a 20-minute OpenAI interview; as the AI says goodbye the WebRTC connection state flips to `failed`/`disconnected` (flaky mobile). `handleOaiDrop()` sets `erroredRef.current = true` then `finalize(currentFinalStatus())`. `interviewFinalStatus` returns `"failed"` whenever `errored` is true — regardless of the 20 captured turns. `/complete` then skips both billing and scoring (both gate on `status === "completed"`), so the full transcript persists but the scorecard is never synthesized and the `scorecard_review` approval that drives the Interview→Offer gate never lands.
- **Root cause**: `errored` is treated as strictly disqualifying, conflating "the socket closed uncleanly" with "no real conversation happened." A late-call transport blip on a substantively finished interview is indistinguishable from a 2-second connect blip.
- **Impact**: A real, completed interview shows as "failed" with a transcript but no scorecard; the recruiter's automated gate silently stalls and they must manually review or reissue. Not data loss (transcript is saved), but a broken core flow.
- **Fix sketch**: Let `interviewFinalStatus` treat a drop *after* a substantive conversation (e.g. `reachedLive && turnCount >= N`) as "completed-with-warning" rather than "failed", or score any persisted transcript above a turn threshold regardless of the error flag — decouple "clean teardown" from "scoreable."

## 3. No "connection unstable / reconnecting" feedback during the 8-second WebRTC drop debounce — the candidate talks into a dead pipe

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: missing-ui-state / connection-feedback
- **File**: `app/_components/voice/VoiceInterview.tsx:629-649` (drop debounce) and `:1229-1268` (`StatusPill`)
- **Scenario**: The OpenAI `pc.onconnectionstatechange` handler debounces a `"disconnected"` state for a full 8s (`dropTimerRef`) before surfacing `errConnectionLost`. During those 8 seconds nothing in the UI changes: `phase` stays `"live"`, `StatusPill` still renders "Listening"/"AI speaking", the elapsed timer keeps ticking. A candidate whose network hiccups keeps answering — often the whole 8s worth of their reply — into a connection that may already be gone, then is abruptly told the call was lost.
- **Root cause**: The drop grace is a silent backend debounce with no corresponding UI state; `StatusPill` is derived only from `phase` + `speaking`, neither of which reflects a degraded/reconnecting connection.
- **Impact**: The interface actively reassures the candidate ("Listening") while the transport is failing, so answers are wasted and the eventual error feels arbitrary — the worst possible feel on a one-shot, high-stakes screen.
- **Fix sketch**: Add an `unstable` connection sub-state set the moment `connectionState === "disconnected"` (cleared on `"connected"`); render a "Connection unstable — trying to reconnect…" pill and freeze/annotate the elapsed timer. Reuse it for the ElevenLabs path when the SDK exposes a comparable status.

## 4. The AI's voice plays through a hidden `<audio autoPlay>` with no output volume/mute control and no `play()`-rejection fallback

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: missing-ui-state / media-recovery
- **File**: `app/_components/voice/VoiceInterview.tsx:862` (`<audio … autoPlay hidden />`) and `:367-379` (`toggleMute` — candidate mic only)
- **Scenario**: `[STILL-OPEN]` (prior report #2, still present). The interviewer's speech — the load-bearing channel of a *voice* interview — is played by a fire-and-forget hidden `<audio autoPlay>`. There is a mute for the candidate's own mic but **no volume/mute for the AI's output** and no handling of an `audio.play()` rejection. On a browser/tab that blocks or de-prioritises autoplay (strict mobile Safari, low-power mode), or when the candidate needs the AI quieter/louder, they get silence or a fixed level with no on-screen control and no "tap to enable audio" recovery.
- **Root cause**: The audio element is treated as plumbing, not a first-class, controllable media surface; there is no failure path for `play()` and no output-side affordance.
- **Impact**: Still matters because the audio channel is the interview — a candidate who can't hear the question has no recovery cue and only a delayed transcript to fall back on. Marked `[STILL-OPEN]` (my single allowed) because it is candidate-facing and unaddressed by the busy-state/mic a11y wave.
- **Fix sketch**: Bind a small speaker/volume + mute control to `audioRef`; on the promise returned by `audio.play()`, `.catch()` and render a "Tap to enable audio" button that re-invokes `play()` from a user gesture. Keep it inside the `aria-busy` controls block so it's announced.

## 5. ElevenLabs End→unmount race beacons a cleanly-ended call as "failed", dropping its scorecard

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: race-condition
- **File**: `app/_components/voice/VoiceInterview.tsx:826-845` (`end()`) and `:523-556` (unmount teardown)
- **Scenario**: On the ElevenLabs path, `end()` calls `endSession()` and defers the verdict to `onDisconnect`, with a 3s fallback timer (`EL_DISCONNECT_GRACE_MS`). If the candidate clicks **End** and immediately closes the tab / navigates away (sub-second, before `onDisconnect` fires), the unmount effect runs first: `!finalizedRef.current && reachedLiveRef.current` is still true, so it latches `finalizedRef` and `sendBeacon`s the transcript with a hardcoded `status: "failed"` (`:543`). A cleanly, intentionally *ended* interview is persisted as failed → `/complete` skips scoring → no scorecard, no Interview→Offer approval.
- **Root cause**: The unmount beacon assumes "not yet finalized while live" == "abandoned/failed", but a just-clicked End is exactly that window; the beacon can't see that a clean end is in flight.
- **Impact**: Narrow timing window, but when it hits it downgrades a completed interview and silently discards its scorecard — the same failure mode as #2, reached a different way.
- **Fix sketch**: When `end()` is invoked, set a `endInFlightRef` (or `phase === "ending"`) and have the unmount beacon send `currentFinalStatus()` instead of a hardcoded `"failed"` — so an ending that already went live with turns beacons "completed"; only a truly never-ended live call beacons "failed."
