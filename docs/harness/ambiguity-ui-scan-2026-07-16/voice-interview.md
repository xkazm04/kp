# Voice Interview — ambiguity-guardian + ui-perfectionist scan

> Total: 6 findings (0 critical, 1 high, 4 medium, 1 low)

## 1. "Completed" only requires one turn of ANY role — an interviewer-only call is terminal, billed, and scored
- **Severity**: High
- **Lens**: ambiguity
- **Category**: silent-mic-scored-as-completed
- **File**: `app/_lib/voice/finalize-status.ts:53`
- **Scenario**: A candidate's mic captures nothing (hardware fault after the pre-call test, OS-level mute, VAD never triggering). The AI greets them ("Tell me about your recent work…"), the candidate gives up and clicks End → confirm. `currentFinalStatus()` sees `reachedLive=true, turnCount=1, errored=false` → `"completed"`.
- **Root cause**: `hadRealConversation = signals.reachedLive && signals.turnCount > 0` counts turns of any role. The interviewer's opening turn alone satisfies it, so the "zero-turn hang-up stays failed/retryable" story (comments at `VoiceInterview.tsx:973-977` and the H5 no-audio card, which keys on `turns.length === 0`) only holds when the AI *also* never spoke — which almost never happens, because the agent always opens.
- **Impact**: The session is persisted `completed` → terminal server-side (`/connect` 409s, candidate permanently locked out of their own link with no recruiter alert), interview minutes are billed, and `/api/interview/complete` runs `runInterviewScorecard` on a transcript containing zero candidate words — setting the `scorecard_review` approval that feeds the Interview→Offer gate from an empty interview.
- **Fix sketch**: Add `candidateTurnCount` to `InterviewEndSignals` and require `candidateTurnCount > 0` (the client already has roles in `turnsRef`). Defense in depth in `/api/interview/complete`: gate scoring (and arguably `status: "completed"`) on the transcript containing at least one `role === "candidate"` turn, since the status field is client-supplied.

## 2. The completed-vs-failed verdict is snapshotted before finalize() flushes the last turns it will persist
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: verdict-transcript-skew
- **File**: `app/_components/voice/VoiceInterview.tsx:978`
- **Scenario**: An OpenAI call blips (`erroredRef` set) at 5 captured turns while the candidate's 6th answer is pending transcription; the candidate clicks End. `end()` computes `currentFinalStatus()` → `"failed"` (5 < `SUBSTANTIVE_TURNS`=6) *before* `finalize()` runs. Because the final-turn grace wait at `VoiceInterview.tsx:316-324` is gated on `status === "completed"`, the pending answer is not even waited for — yet the assistant-buffer flush still appends turns to the transcript that gets POSTed.
- **Root cause**: `end()`/`handleOaiDrop()` evaluate `interviewFinalStatus` over `turnsRef` *at call time*, then `finalize(status)` mutates `turnsRef` (buffer flushes, grace-rescued utterance) after the verdict is frozen. The verdict and the persisted transcript describe two different states of the call; additionally the rescue of the candidate's closing answer is conditioned on the verdict it could itself change.
- **Impact**: Calls near the substantive threshold get inconsistently classified — a genuinely substantive conversation can persist as `failed` (skipping the scorecard, stalling the pipeline until someone notices) with a transcript that visibly crosses the threshold; conversely the stored `completed` transcript can differ from what the verdict was judged on. Painful to debug because `finalize-status.ts` promises a "single source of truth" that call sites then feed stale inputs.
- **Fix sketch**: Move the verdict inside `finalize()`: perform the pending-utterance grace wait and buffer flushes first (unconditionally, or gated on `!errored` rather than on the pre-computed status), then compute `interviewFinalStatus` from the final `turnsRef` once, and use that for both the UI (`endedAs`) and the POSTed status.

## 3. The sessionStorage transcript stash is write-only — the promised reload durability doesn't exist
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: dead-recovery-path
- **File**: `app/_components/voice/VoiceInterview.tsx:269`
- **Scenario**: The save POST fails (all 3 retries) on a flaky network; the candidate — or the copy telling them their answers are safe — reloads the page or navigates away and comes back. The transcript is gone.
- **Root cause**: `persistTranscript` stashes the POST body under `kp.iv.<sid>` "so a total POST failure doesn't vanish it", and the M6 comment says the retry works because "the body is stashed in sessionStorage" — but the retry path (`retrySave`) reads only in-memory `turnsRef`, and no code in the repo ever reads `kp.iv.*` back (grep: the write site is the only hit; the 2026-06-12 scan flagged this and only the retry-button half was built). The unmount beacon can't help either: `finalizedRef` is already latched by the failed finalize, so the cleanup skips the beacon.
- **Impact**: The one scenario the stash exists for — losing the tab after a failed save — still loses the only record of the interview, while the code (and its comments) claim otherwise. The session stays `in_progress`/`failed` with no transcript; the candidate believes they finished.
- **Fix sketch**: On portal mount (and/or in `retrySave`), scan `sessionStorage` for `kp.iv.*` entries and best-effort re-POST them — `/complete` is idempotent (`alreadyCompleted` on duplicates, refuses empty-over-nonempty), so replay is safe by design. If replay is deliberately out of scope, delete the stash write and the comment so the code stops promising durability it doesn't provide.

## 4. Pre-flight failure copy is hardcoded English on a four-locale candidate portal
- **Severity**: Medium
- **Lens**: ui
- **Category**: unlocalized-error-copy
- **File**: `app/_lib/voice/preflight.ts:48`
- **Scenario**: A Czech candidate opens the interview link inside the Gmail in-app webview — the exact "single most common real-world failure" this module was built for — and gets a three-sentence English instruction ("This browser can't capture microphone audio… Open the link in a full browser like Chrome…") on a page whose every other string is in Czech.
- **Root cause**: `voicePreflightError` returns finished English prose, and `VoiceInterview.tsx:842-844` pipes it straight into `setError`. Every sibling failure (`errMicDenied`, `errMicNotFound`, `errConnectTimeout`, `errConnectionLost`, …) goes through `t()` with translations present in all four message files (`messages/cs|de|en|fr.json`).
- **Impact**: The least technical, highest-stakes audience (first-round candidates on mobile webviews) receives the most technical instruction in the wrong language, at the exact moment they need actionable guidance; visually it also breaks the otherwise fully localized error surface.
- **Fix sketch**: Have `voicePreflightError` return a message *key* (e.g. `"errPreflightInsecure" | "errPreflightNoMedia" | "errPreflightNoWebrtc"`) — the helper stays pure and unit-testable, `preflight.test.ts` asserts keys instead of prose — and let the component render `t(key)`, adding the three keys to all four locale files.

## 5. Locked candidate mode collapses every non-Czech locale to a hard "en" language pin
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: silent-locale-assumption
- **File**: `app/_components/voice/VoiceInterview.tsx:100`
- **Scenario**: A candidate browses the portal in German or French (both shipped locales). The seed `locale === "cs" ? "cs" : "en"` pins the language hint to `"en"`, which is then sent as the ElevenLabs `overrides.agent.language` and — on OpenAI — pins input transcription to English (`buildOpenAiSessionPayload`, `app/_lib/voice/openai.ts:118-120`). If that candidate then answers in Czech (common: UI locale ≠ spoken language), the transcription runs against the wrong language pin, and the prompt's "follow the candidate's language" rule was precisely what the pin was added to override.
- **Root cause**: The comment documents seeding "from the candidate's UI locale", but the actual rule is "cs or else English" — an undocumented assumption that UI locale equals spoken language and that only Czech deserves a native path, hardened by `LangHint` and the EL override type both being `"cs" | "en"`. Unlike the lab, locked mode has no `"auto"` escape and no visible picker, so the candidate can't correct it.
- **Impact**: de/fr-locale candidates (and cs speakers browsing in another locale) get an English-pinned interviewer and, on OpenAI, English-pinned transcription of non-English speech — degraded transcripts feeding the scorecard, with no signal that a pin (rather than detection) was in play.
- **Fix sketch**: In locked mode, map only *known* interview languages to a pin (`cs → "cs"`, `en → "en"`) and fall back to `"auto"` (omit the override / transcription language, letting both providers detect) for every other locale. Document in `types.ts` that the interview currently supports cs/en so the next locale addition revisits this seam deliberately.

## 6. Revoke failures are reported under the "create" error code and escape the hygiene lock
- **Severity**: Low
- **Lens**: ambiguity
- **Category**: copy-paste-error-code
- **File**: `app/api/interview/revoke/route.ts:20`
- **Scenario**: A recruiter's revoke call hits a DB error. The response and server log carry `INTERVIEW_CREATE_FAILED` — anyone triaging (or any dashboard grouping by stable code) reads it as a link-*creation* failure and looks in the wrong place, while the link they meant to kill may still be live.
- **Root cause**: `safeJsonError(error, "api:interview:revoke", "INTERVIEW_CREATE_FAILED")` — the third argument was copy-pasted from the create route. Corroborating: `error-message-hygiene.test.ts` enumerates every interview route *except* `./revoke/route.ts` in its `ROUTES` list, so neither the code catalogue nor the safe-responder invariants cover this endpoint.
- **Impact**: Misattributed telemetry/logs for a security-relevant action (pulling a live credential), and the one interview route outside the error-hygiene lock is free to regress into raw-message leaking unnoticed.
- **Fix sketch**: Add `INTERVIEW_REVOKE_FAILED` to the `STORE_ERRORS` catalogue in `app/_lib/api-response.ts`, use it in the revoke route, and add `./revoke/route.ts` (plus the new code) to the hygiene test's `ROUTES`/code lists so the invariant covers all five endpoints.
