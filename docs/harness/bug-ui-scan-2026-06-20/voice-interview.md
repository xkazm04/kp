# Voice Interview — UI Perfectionist scan

> Context: In-browser voice first-round interview with an AI agent (OpenAI Realtime / ElevenLabs switcher): create, connect, run, transcribe, and complete the session.
> Files reviewed: 8 of 30
> Total: 7 findings — Critical: 0, High: 3, Medium: 3, Low: 1

## 1. No visible label/animation while the mic permission prompt is open — candidate stares at a frozen "Connecting…"

- **Severity**: High
- **Category**: missing-feedback / live-audio-a11y
- **File**: `app/_components/voice/VoiceInterview.tsx:494` (timer) and `app/_components/voice/VoiceInterview.tsx:410` (`getUserMedia`)
- **Scenario**: A candidate clicks **Start call** (OpenAI path). `navigator.mediaDevices.getUserMedia({ audio: true })` opens the OS/browser mic-permission prompt, which can sit open for many seconds. During that time the UI is locked in `phase === "connecting"` with only the static "Connecting…" pill; nothing tells the candidate *"grant the microphone in the prompt at the top of your browser."*
- **Root cause**: The `connecting` phase conflates two very different waits — "asking the OS for the mic" vs. "dialing the provider" — and renders identical, non-actionable copy for both. There is no "awaiting-permission" sub-state.
- **Impact**: The single most common first-call confusion: candidates don't realize the browser is waiting on *them*, let the 30s timer fire, hit `errConnectTimeout`, and conclude the interview is broken. High blast radius on a candidate-facing screen where the first 30s decide the whole session.
- **Fix sketch**: Add a transient `awaiting-mic` indicator: before calling `getUserMedia`, render a short instruction line ("Allow microphone access in your browser to continue") next to the Connecting pill; clear it once `getUserMedia` resolves. Optionally arrow/point toward the address bar. Keep it inside the existing `aria-busy` controls block so SR users hear it too.

## 2. The hidden `<audio>` element has no captions/mute affordance and `aria-busy` only covers `connecting`, leaving "ending" with no spinner state

- **Severity**: High
- **Category**: a11y / missing-state
- **File**: `app/_components/voice/VoiceInterview.tsx:586` (`<audio … hidden />`) and `:687` (`aria-busy={phase === "connecting"}`)
- **Scenario**: The AI interviewer's voice plays through an `autoPlay hidden` `<audio>` element with no user-facing volume/mute control and no visible transcript-sync indication that audio is the *primary* channel. A Deaf/hard-of-hearing candidate, or one in a no-audio environment, gets the spoken question only as a delayed transcript turn and has no way to confirm audio is even playing or to adjust it. Separately, `aria-busy` is set only for `connecting`, so the `ending` phase (which also blocks input and shows a disabled End button) is not announced as busy.
- **Root cause**: The audio element is treated as fire-and-forget plumbing rather than a first-class media control; busy state is hardcoded to a single phase instead of derived from `isBusy`.
- **Impact**: For an AI-led *voice* interview the audio channel is load-bearing; with no mute/volume and no autoplay-failure fallback, a candidate whose browser blocks autoplay hears silence with zero recovery cue. The `aria-busy` gap means SR users aren't told the app is wrapping up.
- **Fix sketch**: Surface a small mute/volume toggle bound to the `<audio>` element and a "speaker" indicator that lights with `conversation.isSpeaking`; detect `audio.play()` rejection (autoplay block) and show a "tap to enable audio" button. Change `aria-busy={phase === "connecting"}` to `aria-busy={isBusy}` (already computed at `:578`).

## 3. Transcript `role="log"` re-announces the AI's streamed turn, and candidate turns are right-aligned with no reliable reading order

- **Severity**: High
- **Category**: a11y
- **File**: `app/_components/voice/VoiceInterview.tsx:745-784` (the `role="log" aria-live="polite"` container) and `:254`/`:399` (interviewer turn pushed on flush/`assistantDone`)
- **Scenario**: The whole transcript is an `aria-live="polite"` log. Each interviewer turn is appended only once (good), but the live status pill at `:826` *also* uses `role="status"` and announces "AI speaking" / "Listening" continuously. A screen-reader user thus hears the rotating status spam interleaved with each new transcript line. Additionally, candidate bubbles use `flex-row-reverse` + `text-right` (`:795`) — visually a chat, but the per-turn role label ("You" / "Interviewer") is a `text-meta uppercase` caption that is easy to miss and the only cue distinguishing speakers.
- **Root cause**: Two overlapping live regions (the log and the status pill) compete, and speaker identity relies on a low-contrast micro-label rather than semantic structure.
- **Impact**: Verbose, confusing SR output during a high-stakes live interview; users can lose track of who said what.
- **Fix sketch**: Demote the StatusPill from a live region during `live` (it changes every second) — keep `role="status"` only for discrete phase transitions, or give the speaking/listening micro-state `aria-live="off"` and rely on the per-turn log. Wrap each turn in a list/`<article>` with a visually-hidden "Interviewer said:" / "You said:" prefix so the speaker is announced in reading order regardless of visual alignment.

## 4. "Start again" after a *failed* ending re-enables Start but the consent checkbox silently keeps its prior value, and a stale `error` banner persists under the controls

- **Severity**: Medium
- **Category**: error-state / stale-UI
- **File**: `app/_components/voice/VoiceInterview.tsx:689-715` and `:720-724`
- **Scenario**: A call ends as `failed` (zero-turn hang-up, error blip, or the 30s timeout → `phase === "error"`). The retry controls reappear (good), but: (a) the `error` banner from the previous attempt stays rendered below until the next `start()` clears it at `:476`, so the candidate sees a red error *and* a ready Start button simultaneously — contradictory affordances; (b) on an `error` phase the Start button label resolves to `startCall` (not `startAgain`) because the `phase === "ended"` check at `:697` is false for `phase === "error"`, so the same dead-end can read as a fresh start.
- **Root cause**: Retry UI is spread across `ended`-vs-`error` phases with inconsistent copy and no clearing of the prior error until the user commits to a new attempt.
- **Impact**: Mixed signals ("did it fail or is it ready?"), eroding trust on a candidate-facing screen; the error text describing the *last* failure lingers beside a button labelled as if nothing happened.
- **Fix sketch**: Clear `error` when the controls re-enter a retry-able state (or render the banner only while `phase === "error"` and hide it once Start is pressed). Make the Start label `startAgain` for both `ended` (failed) and `error` phases — e.g. `phase === "ended" || phase === "error" ? t("startAgain") : t("startCall")`.

## 5. Provider/language settings lock on `isBusy` but the lab can land on a provider with no keys and only a tooltip explains the disabled Start

- **Severity**: Medium
- **Category**: empty/disabled-state clarity
- **File**: `app/_components/voice/VoiceInterview.tsx:625-644` (picker) and `:711-715` / `:693` (disabled Start)
- **Scenario**: In the lab (no `lockSettings`), if availability resolves with the selected provider unconfigured, the Start button is `disabled` via `!providerAvailable` and a `text-meta text-coral` "keys not configured" line appears — but only after availability loads. Before `availability` resolves, `providerAvailable` defaults to `true` (`:580`), so Start is briefly enabled and clicking it races a `/connect` that may 403. The disabled provider buttons rely on a `title` tooltip (`:635`) which is invisible to touch and keyboard users.
- **Root cause**: `providerAvailable` optimistically defaults to `true` while loading, and the "why is this disabled" explanation is tooltip-only.
- **Impact**: A confusing dead Start click during the availability race; keyboard/touch users get no reason for the greyed-out provider.
- **Fix sketch**: Default `providerAvailable` to `false`/unknown until `availability !== null` and show a "checking providers…" state; replace the tooltip-only reason with the already-rendered `· {notSet}` text being programmatically associated (e.g. `aria-describedby`) so AT announces it.

## 6. Live transcript auto-scrolls to bottom unconditionally, fighting a candidate who scrolls up to re-read an earlier question

- **Severity**: Medium
- **Category**: interaction-correctness / scroll-jacking
- **File**: `app/_components/voice/VoiceInterview.tsx:146-149`
- **Scenario**: Every time `turns` changes, the effect force-sets `logRef.scrollTop = scrollHeight`. If a candidate scrolls up mid-interview to re-read the interviewer's multi-part question while the AI streams its next turn (or their own answer is transcribed), the view yanks back to the bottom on each delta/turn.
- **Root cause**: Pin-to-bottom is applied unconditionally instead of only when the user is already near the bottom.
- **Impact**: Candidates can't comfortably reference earlier context during a live, time-pressured screen; classic scroll-jack annoyance, worse on mobile where the transcript is `max-h-[520px]` and scrolly.
- **Fix sketch**: Before scrolling, check whether the user is near the bottom (`scrollHeight - scrollTop - clientHeight < threshold`); only auto-pin when true. Otherwise show a small "↓ new" affordance to jump back.

## 7. Equalizer/listening animations have no `prefers-reduced-motion` guard

- **Severity**: Low
- **Category**: a11y / motion
- **File**: `app/_components/voice/VoiceInterview.tsx:833-839` (`voice-eq-bar`, `voice-listen`) and `:732-733` (live badge pulse)
- **Scenario**: The "AI speaking" equalizer bars, the breathing `voice-listen` dot, and the live-badge pulse animate continuously throughout the call via CSS classes, with no respect for the user's reduced-motion preference (the inline `animationDelay` styles confirm these are JS-driven CSS animations).
- **Root cause**: Motion is added at the component level without a `@media (prefers-reduced-motion: reduce)` fallback (couldn't confirm one exists for `voice-eq-bar`/`voice-listen` in the reviewed files).
- **Impact**: Vestibular-sensitive candidates get sustained motion for the entire interview duration — minor but persistent, and an easy WCAG 2.3.3 win.
- **Fix sketch**: Gate the `voice-eq-bar` / `voice-listen` / live-badge keyframes behind `@media (prefers-reduced-motion: reduce) { animation: none }` (or swap to a static "speaking"/"listening" dot), in the stylesheet defining those classes.
