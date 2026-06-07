# Bug Hunt — Voice Interview Runtime

> Total: 6
> Critical: 0 | High: 3 | Medium: 2 | Low: 1

## 1. ElevenLabs has no last-answer protection — endSession() races the final onMessage and silently drops the closing turn
- **Severity**: High
- **Category**: race-condition
- **File**: C:/Users/mkdol/dolla/kp/app/_components/voice/VoiceInterview.tsx:409
- **Scenario**: Candidate finishes their last answer and clicks "End call". `end()` runs `setPhase("ending")` → `conversation.endSession()` → `await finalize("completed")`. `finalize` immediately sets `finalizedRef.current = true` and POSTs `turnsRef.current` as it stands at that microtask. The ElevenLabs SDK delivers the candidate's *final* utterance (and the agent's closing line) via `onMessage` (line 233), and that finalized-transcript message frequently arrives a few hundred ms AFTER `endSession()` is invoked — i.e. after the POST has already gone out and `finalizedRef` is latched. The later `onDisconnect` calls `finalize` again, but it is a no-op because `finalizedRef` is already true, so the freshly-arrived turn is never persisted.
- **Root cause**: The OpenAI path has an explicit grace window in `finalize()` (lines 164–172: `pendingCandidateRef` + `waitUntil(OAI_FINAL_TURN_GRACE_MS)`), but the ElevenLabs branch has no equivalent. `endSession()` is fire-and-forget and `finalize` does not wait for in-flight `onMessage` events or for `onDisconnect` to settle before snapshotting `turnsRef`. ElevenLabs `onMessage` for the user side is itself a server-side finalized transcript that lags the spoken audio, widening the race.
- **Impact**: The candidate's last — often most decision-relevant — answer is dropped from the transcript that feeds `runInterviewScorecard` and the Interview→Offer gate. Silent: no error, status persists as "completed", recruiter sees a transcript that ends one turn early with no indication anything was lost.
- **Fix sketch**: Give the ElevenLabs path a grace window mirroring OpenAI. In `end()`, for elevenlabs, don't synchronously `finalize`; instead call `endSession()` and let `onDisconnect` drive `finalize` (it already maps signals correctly), with a fallback timer so a missing `onDisconnect` still finalizes. Inside `finalize`, before snapshotting `turnsRef`, `await waitUntil(() => disconnectSettledRef.current, GRACE_MS)` so a final `onMessage` arriving between `endSession()` and socket-close is captured. Track turn count at end-of-call and only POST after the SDK reports the conversation closed.

## 2. getUserMedia mic stream leaks when the 30s connect timeout (or unmount) fires mid-acquisition
- **Severity**: Medium
- **Category**: leak
- **File**: C:/Users/mkdol/dolla/kp/app/_components/voice/VoiceInterview.tsx:298
- **Scenario**: User clicks Start. `startOpenAi` awaits `navigator.mediaDevices.getUserMedia({audio:true})` (line 298) — the browser permission prompt can sit for many seconds. If the 30s connect timeout fires (lines 351–363) or the component unmounts while that await is pending, the timeout handler runs `teardownOpenAi()` while `micRef.current` is still `null` (not yet assigned). When `getUserMedia` finally resolves, line 299 assigns `micRef.current = mic` and line 300 adds the now-orphaned tracks to a `pcRef` that teardown already closed/nulled.
- **Root cause**: `teardownOpenAi()` only stops tracks reachable via `micRef.current`/`pcRef.current` at the instant it runs. A stream acquired *after* teardown is never stopped, and `finalizedRef`/timeout do not abort the in-flight `getUserMedia`. The mic indicator stays on and the `MediaStream` (microphone hardware) is held until GC.
- **Impact**: Microphone stays hot after a failed/aborted connect; on repeated retries the user accumulates live audio tracks. On a candidate device this is a privacy-visible "mic still on" after the call supposedly failed.
- **Fix sketch**: After `getUserMedia` resolves, check the abort condition before wiring it up: `if (finalizedRef.current || pcRef.current !== pc) { mic.getTracks().forEach(t => t.stop()); return; }`. Better, thread an `AbortController` from `start()`/timeout/unmount and pass its signal so the acquisition itself can be cancelled.

## 3. Connect timeout latches finalizedRef=true, so a slightly-late ElevenLabs onConnect leaves a live, unsendable call
- **Severity**: High
- **Category**: state-corruption
- **File**: C:/Users/mkdol/dolla/kp/app/_components/voice/VoiceInterview.tsx:351
- **Scenario**: ElevenLabs connect takes ~31s (cold agent, slow network). At 30s the timeout handler runs: sets `finalizedRef.current = true`, calls `teardownOpenAi()` (no-op for EL), `conversation.endSession()`, and shows the "Couldn't connect within 30s" error. But `endSession()` on a still-connecting socket may not abort it, and the SDK can then fire `onConnect` a second later → `reachedLiveRef = true`, `setPhase("live")`. The candidate now sees a live call and talks. When they click End, `finalize` returns immediately at line 152 because `finalizedRef.current` is already `true` — the transcript is NEVER POSTed.
- **Root cause**: The timeout sets `finalizedRef` (to suppress a transcript POST for a dead connect) but does not also force a terminal UI state guard, and `endSession()` is not guaranteed to prevent a subsequent `onConnect`. The two end-of-life signals (`finalizedRef` and `phase`) can disagree: `phase==="live"` while `finalizedRef===true`.
- **Impact**: A full interview can run and be completely lost — no transcript persisted, no scorecard, candidate believes they completed the screen, recruiter sees nothing. Worse than a clean failure because it looks successful to the candidate.
- **Fix sketch**: In `onConnect`, ignore the event if `finalizedRef.current` is true (the call was already abandoned): `if (finalizedRef.current) { try { conversation.endSession(); } catch {} return; }`. Alternatively, don't latch `finalizedRef` in the timeout; instead mark a separate `connectAbortedRef` and have `finalize` treat it as "failed" while still allowing a clean teardown path.

## 4. finalize() POST is fire-and-forget with a swallowed catch — transcript loss on a failed network write is silent and unrecoverable
- **Severity**: High
- **Category**: silent-failure
- **File**: C:/Users/mkdol/dolla/kp/app/_components/voice/VoiceInterview.tsx:193
- **Scenario**: Candidate completes the interview; `finalize` POSTs the transcript to `/api/interview/complete`. The candidate is on flaky mobile/wifi and the request fails (offline, DNS, timeout, 5xx). The `catch {}` at line 198 swallows it ("best-effort persist"), `phase` is already "ended", and the UI shows "Call ended". There is no retry, no surfaced error, and no local persistence. `finalizedRef` is latched so even a manual retry of `end()` does nothing.
- **Root cause**: The only durable write of the entire interview is a single best-effort `fetch` with no retry, no status check on `res.ok`, and no user-visible failure path. The function also never inspects the response — a 403 (consent), 404 (token), or 5xx is indistinguishable from success to the candidate.
- **Impact**: Entire transcript (and therefore the scorecard / Interview→Offer evidence) is lost with zero signal to candidate or recruiter. The candidate cannot retry because the link may now be considered started, and the UI gives no indication anything failed.
- **Fix sketch**: Check `res.ok`; on failure show a non-fatal banner ("We couldn't save your interview — please don't close this tab") and retry with backoff a few times. Persist `turnsRef` to `sessionStorage` keyed by sessionId before the POST so a reload can re-submit. Do not set `phase="ended"` until a successful (or explicitly-abandoned) persist.

## 5. Unmount during a live OpenAI call never persists the transcript
- **Severity**: Medium
- **Category**: recovery-gap
- **File**: C:/Users/mkdol/dolla/kp/app/_components/voice/VoiceInterview.tsx:258
- **Scenario**: Candidate is mid-OpenAI-interview and navigates away / closes the tab / the route unmounts the component. The unmount effect (lines 258–269) clears the connect timer, calls `conversation.endSession()` only for ElevenLabs, and `teardownOpenAi()`. It never calls `finalize`, so for OpenAI the in-progress transcript in `turnsRef` is discarded without a `/complete` POST.
- **Root cause**: The teardown effect tears down transport but does not flush/persist. For ElevenLabs `endSession()` may trigger `onDisconnect → finalize`, but on unmount the component is gone so that callback can't run reliably either; for OpenAI there is no persistence attempt at all. Browser unload of an interview has no `navigator.sendBeacon`/`keepalive` fallback.
- **Impact**: Accidental tab close or back-navigation during a real interview loses the whole transcript silently. Common candidate behavior (misclick, notification, app-switch on mobile) → no scorecard, no evidence.
- **Fix sketch**: In the unmount path (and a `beforeunload`/`pagehide` listener), if `phase` is live/ending and not finalized, POST `turnsRef` with `fetch(..., { keepalive: true })` or `navigator.sendBeacon` so the partial transcript is persisted as at least "failed"/partial rather than vanishing.

## 6. Provider switch after a completed call reuses a stale sessionTokenRef from the previous session
- **Severity**: Low
- **Category**: state-corruption
- **File**: C:/Users/mkdol/dolla/kp/app/_components/voice/VoiceInterview.tsx:378
- **Scenario**: In the lab (tokenless) harness: run one session to completion (sets `sessionIdRef`/`sessionTokenRef` from the first `/connect`). Click "Start again" with a different provider. `start()` resets transcript/flags but does NOT reset `sessionIdRef`/`sessionTokenRef`. The new `/connect` returns a new `sessionId`/`token` and they are reassigned at lines 377–378 — but only after the awaited fetch resolves. If that second `/connect` fails before assignment (e.g. provider 503), `finalize` could still read the *previous* session's `sid`/`tok` and POST the new (empty/failed) transcript against the old, already-completed session.
- **Root cause**: `sessionIdRef`/`sessionTokenRef` are not cleared at the top of `start()` alongside the other per-call refs (lines 339–347), so a failed re-connect leaves stale capability identifiers in scope for `finalize`.
- **Impact**: Low in practice (the prior session is `completed`, so `/complete` returns the idempotent already-completed response and refuses the overwrite). But it is a latent cross-session binding: an empty finalize after a failed restart is attributed to the wrong session id. Tightening it removes a confusing class of "why did session X get a stray complete call".
- **Fix sketch**: Reset `sessionIdRef.current = null; sessionTokenRef.current = null;` in the per-call reset block at the start of `start()`, so `finalize`'s `if (sid && tok)` guard skips when a re-connect hasn't yet produced fresh identifiers.
