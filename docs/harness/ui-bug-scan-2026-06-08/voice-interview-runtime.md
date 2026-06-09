# Voice Interview Runtime — UI+Bug combined scan
> Total: 4 findings (0 crit / 2 high / 1 med / 1 low)
> Group: Interviews | Lens mix: 3 bug / 1 ui | Files read: 17

W4 fixes verified intact: EL `end()` defers finalize to `onDisconnect` with the
`EL_DISCONNECT_GRACE_MS` fallback timer (VoiceInterview.tsx:509-533); `persistTranscript`
stashes to sessionStorage, retries 3× with `keepalive`, surfaces a banner on total
failure (161-195, 240-244); unmount `sendBeacon` flushes a partial as "failed"
(326-341); `finalizedRef` guards re-entry in `finalize` (199-200) and the late-`onConnect`
abandon path (255-262). None re-flagged. The two High findings below are OpenAI-path
gaps that the EL-centric W4 pass did not touch.

## 1. OpenAI hang-up with no turns locks the session as "completed" forever
- **Severity**: High
- **Lens**: bug
- **Category**: edge case / asymmetric finalize / candidate lockout
- **File**: `app/_components/voice/VoiceInterview.tsx:535` (and 509-536)
- **Scenario**: An OpenAI-provider session connects, the candidate says nothing (or the audio path is one-directional and no transcript turn lands), then clicks **End call**. `end()` for the non-ElevenLabs branch calls `await finalize("completed")` unconditionally.
- **Root cause**: The ElevenLabs branch routes through `interviewFinalStatus({ reachedLive, turnCount, errored })` (lines 522-531, 274-280), which returns `"failed"` whenever `turnCount === 0` — keeping the session reconnectable. The OpenAI branch hardcodes `"completed"` and never consults turn count or `erroredRef`. `finalize` then POSTs `status:"completed"` with an empty `turnsRef`. In `/api/interview/complete`, the "never replace non-empty with empty" guard (route.ts:106) does NOT fire for a first completion (stored transcript is empty), so `completeInterviewSession` writes `status='completed'` (db.ts:2960-2978). The session is now terminal: `/connect` returns 409 "already been completed" (connect/route.ts:66-68) and the portal page renders the "Thank you" dead-end (page.tsx:23-32).
- **Impact**: A candidate whose OpenAI call produced zero captured turns (silent mic, transcription failure, mistaken early End) is permanently locked out of their own interview link, with an empty transcript and no scorecard. ElevenLabs candidates in the identical situation get `"failed"` and can retry. Same code path, opposite outcome.
- **Fix sketch**: Make the OpenAI branch mirror ElevenLabs: `await finalize(interviewFinalStatus({ errored: erroredRef.current, reachedLive: reachedLiveRef.current, turnCount: turnsRef.current.length }))`. (Note the OpenAI delta-flush in `finalize` runs before the POST, so compute turn count after the flush, or let `finalize` itself recompute status post-flush.)

## 2. OpenAI path never sets `reachedLiveRef` → unmount transcript beacon never fires
- **Severity**: High
- **Lens**: bug
- **Category**: silent data loss / timing / teardown
- **File**: `app/_components/voice/VoiceInterview.tsx:419-420` (missing set); fault surfaces at `326`
- **Scenario**: An OpenAI interview is live and mid-conversation (real turns captured). The candidate closes the tab, navigates back, or the component unmounts before clicking End.
- **Root cause**: `reachedLiveRef.current = true` is set in exactly one place — the ElevenLabs SDK `onConnect` callback (line 264). The OpenAI go-live path (`startOpenAi`, after `setRemoteDescription`) calls `clearConnectTimer(); setPhase("live")` (lines 419-420) but never sets `reachedLiveRef`. The unmount cleanup that flushes a partial via `navigator.sendBeacon` is gated on `if (!finalizedRef.current && reachedLiveRef.current)` (line 326). For OpenAI that ref is still `false`, so the beacon is skipped.
- **Impact**: A genuinely in-progress OpenAI interview that ends by tab-close is lost silently — the exact data-loss case the W4 unmount beacon was added to prevent works only for ElevenLabs. The recruiter sees no transcript and no session record of the abandonment. (`erroredRef`/`reachedLive` also flow into `interviewFinalStatus`, so fixing finding #1 with that helper additionally depends on this ref being correct for OpenAI.)
- **Fix sketch**: Set `reachedLiveRef.current = true` alongside `setPhase("live")` at line 420 (and only inside the still-current-connection guard already present at 410-418, so a torn-down/replaced pc doesn't mark a dead call live).

## 3. Candidate portal exposes the internal provider/language picker and lets the candidate override the per-session provider
- **Severity**: Medium
- **Lens**: ui (with a routing/grounding bug edge)
- **Category**: missing mode-awareness / design-contract violation / trust boundary
- **File**: `app/_components/voice/VoiceInterview.tsx:551-605`; consumed by `app/interview/[token]/page.tsx:62-66`
- **Scenario**: A recruiter creates a candidate session fixed to a provider (create/route.ts:29-44 stores `provider`, and `session.instructions` is the grounded brief tailored for it). The candidate opens `/interview/<token>` and sees the same "Voice provider" + "Language" switchers the internal lab uses.
- **Root cause**: `VoiceInterview` has no `mode`/`hideSettings` prop — it always renders the full settings row. The lab page and the portal-page comments both assert "the provider fixed per session", but nothing enforces that in the candidate UI. Worse, the picker defaults to ElevenLabs (`DEFAULT_PROVIDER`, line 39) regardless of the session's stored provider, and `/connect` honors the browser's requested provider over the session's (`requested ?? session0?.provider`, connect/route.ts:70-71). So a candidate on an OpenAI-created session is silently started on ElevenLabs by default; the OpenAI-tailored `session.instructions` are then only partially honored (pushed as an EL prompt override, which requires the agent to allow overrides).
- **Impact**: Candidates are presented with confusing internal A/B controls on an outward-facing page, and the recruiter's deliberate provider/grounding choice can be overridden — degrading transcript/scorecard comparability across candidates for the same job (the whole point of `/compare`).
- **Fix sketch**: Add a `mode`/`locked` prop (or derive from presence of `token`) that hides the provider+language settings on the candidate portal and pins `provider` to the session's stored value; keep the full picker only for the lab. Optionally have `/connect` prefer `session0.provider` for candidate-mode sessions.

## 4. Transcript empty-state copy contradicts the active phase during connecting/ending
- **Severity**: Low
- **Lens**: ui
- **Category**: missing state / inconsistent affordance
- **File**: `app/_components/voice/VoiceInterview.tsx:691-702`
- **Scenario**: The candidate clicks Start; while `phase === "connecting"` (button reads "Connecting…", StatusPill amber) no turns exist yet, so the transcript panel still renders the idle empty state: a mic glyph and "Press "Start the call" when you're ready". The same stale copy shows during `ending` before the final turns flush.
- **Root cause**: The empty state is gated solely on `turns.length === 0` with no phase awareness; it only ever describes the idle case.
- **Impact**: Minor confusion — the panel tells the user to press a button they already pressed (and which now says "Connecting…"). No live-region or functional regression; purely the panel's resting copy.
- **Fix sketch**: Branch the empty-state body on `phase`: show a "Connecting…" / "Waiting for the first question…" affordance (a spinner or the existing `voice-listen` pulse) while `connecting`/`live`-with-no-turns, and keep the "Press Start" copy for `idle`/`ended`.
