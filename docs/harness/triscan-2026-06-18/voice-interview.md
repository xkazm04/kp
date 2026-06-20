# Voice Interview — Tri-Lens Scan
> Total: 5
> Severity: 0 Critical / 2 High / 3 Medium / 0 Low
> Lens: 2 bug / 1 ui / 2 biz

> Context note: this surface has been hardened across many prior waves (idea-IDs, VOX1/W6-4, finalize-status, preflight, consent gating, token-as-capability, idempotent /complete). The genuine remaining value is in the *failure-tail UX* and the *candidate journey*, not in the core lifecycle/security — those are solid. No Criticals genuinely remain here.

## 1. A failed/zero-turn ending silently re-offers "Start the call" with no explanation
- **Lens**: 🎨 UI Perfectionist (primary) · 🐛 Bug Hunter
- **Severity**: High
- **Category**: Voice UI states / dead-end recovery
- **Value**: impact 7/10 · effort 3/10 · risk 2/10
- **File**: `app/_components/voice/VoiceInterview.tsx:656` (the `endedAs === "completed"` branch) and `:689-698` (the controls fall-through)
- **Scenario**: A candidate finishes speaking but a silent mic / transcription failure / mistaken early End / a 2s provider blip makes the call resolve as `endedAs: "failed"` (or `phase: "error"`). The completed closing card is shown ONLY for `endedAs === "completed"`; every failed path falls through to the consent + controls block and the button silently relabels to `t("startAgain")` ("Start again"). The candidate is given a retry button but no statement that **nothing was recorded** and no reason why.
- **Root cause**: The UI distinguishes `completed` (closing card) from everything else (retry controls), but the "else" branch has no explicit failed/empty messaging — it just re-renders the start controls. `saveFailed` only covers a POST failure, not a zero-turn/errored finalize.
- **Impact**: Candidates on a flaky network or with a mic issue see an inscrutable "Start again" and either abandon (lost funnel) or retake without understanding — a poor first impression on the company's behalf, and the most likely real-world end state after the happy path.
- **Fix sketch**: Add an `endedAs === "failed"` info card (mirror the completed card, role="status") with a one-line "We didn't catch a full conversation — nothing was saved. You can start again." above the retry button. Reuse a new `interview.voice` string; gate the card on `phase === "ended" && endedAs === "failed"` plus the `phase === "error"` case.

## 2. No mic-permission-pending state — the prompt sits open under a bare "Connecting…"
- **Lens**: 🎨 UI Perfectionist (primary) · 🐛 Bug Hunter
- **Severity**: Medium
- **Category**: Voice UI states / a11y
- **File**: `app/_components/voice/VoiceInterview.tsx:410` (`getUserMedia`) and `:760-761` (the only "connecting" copy)
- **Scenario**: On Start, OpenAI calls `navigator.mediaDevices.getUserMedia({ audio: true })` (line 410); the browser permission prompt can sit open for many seconds. During that time the only feedback is the generic "Connecting…" pill/copy. A candidate who doesn't notice the prompt (second monitor, mobile sheet) waits, then hits the 30s timeout → `errConnectTimeout`, which blames "microphone permission" only in a long error string after the fact.
- **Root cause**: There is no distinct "awaiting microphone permission" phase between `connecting` and `live`; the permission wait is folded into the opaque connecting state, and the actionable hint arrives only on timeout.
- **Impact**: Avoidable connect failures and confusion at the single highest-friction step of a voice screen (mic grant), especially on mobile where the prompt is a bottom sheet that's easy to miss.
- **Fix sketch**: Set a transient sub-state (e.g. `setPhase("connecting")` plus a ref/flag) immediately before `getUserMedia` and surface "Allow microphone access to continue…" copy + an arrow toward the URL bar in the empty-transcript connecting branch. Clear it once a track is obtained. ElevenLabs grabs mic inside the SDK, so key it on the OpenAI path (or show generically).

## 3. Live transcript `role="log" aria-live="polite"` re-announces on every turn array replace
- **Lens**: 🎨 UI Perfectionist (primary) · 🐛 Bug Hunter
- **Severity**: Medium
- **Category**: Accessibility / captions
- **File**: `app/_components/voice/VoiceInterview.tsx:745-751` (the `role="log"` container) with `:158-164` `pushTurn` replacing the whole `turns` array
- **Scenario**: The transcript is the call's caption track for a deaf/HoH or audio-impaired candidate. `pushTurn` does `setTurns(turnsRef.current = [...turnsRef.current, turn])` — a new array each turn — inside an `aria-live="polite"` `role="log"`. Most screen readers in a `log` region announce only added nodes, but the full re-keyed list (`key={i}` by index, line 775/781) plus React reconciliation can cause some AT to re-read prior turns or mis-associate them, and there is no caption on/off affordance.
- **Root cause**: Index keys on a live-growing list inside a live region, with no distinction between "appended" and "changed" content; the live region also wraps the empty-state placeholder which flips between connecting/listening/wrapping copy (each an aria-live announcement).
- **Impact**: For the exact users who rely on the transcript as captions, announcements can be noisy or repeated; the placeholder churn ("Connecting…"→"Listening…"→"Wrapping up…") is announced as transcript content.
- **Fix sketch**: Key turns by a stable id (timestamp+index), move the phase-placeholder OUT of the `aria-live` log (it already has the StatusPill `role="status"`), and consider `aria-relevant="additions"` on the log so only new turns are announced.

## 4. No in-call progress / elapsed-time cue — candidate can't tell how far along they are
- **Lens**: 🚀 Business Visionary (primary) · 🎨 UI Perfectionist
- **Severity**: Medium
- **Category**: Candidate experience / journey
- **File**: `app/_components/voice/VoiceInterview.tsx:726-744` (transcript header during `live`) and `app/_components/voice/InterviewSidebar.tsx:34-44` (static agenda only)
- **Scenario**: The sidebar shows a static agenda and a duration chip, but once live the candidate has no sense of progress (no "~2 min in", no "topic 2 of 4", no soft time cue). For a 15–25 min grounded debrief this is anxiety-inducing and a common reason candidates over- or under-talk, degrading transcript quality the scorecard depends on.
- **Root cause**: The run-of-show (`session.runOfShow`) and `durationMin` are known client-side but never surfaced as live progress; the live header only shows a "Live" badge.
- **Impact**: Candidate anxiety and uneven pacing → weaker transcripts → noisier scorecards on the Interview→Offer gate; also a missed differentiation moment (a calm, well-paced AI screen is the product's promise).
- **Fix sketch**: Add a lightweight elapsed-time readout (start a timer on `reachedLive`) and a subtle progress hint against `durationMin` in the live transcript header or sidebar. Keep it advisory (the agent controls actual flow); no provider changes needed.

## 5. No "something went wrong — reach a human" escape hatch after repeated failures
- **Lens**: 🚀 Business Visionary (primary) · 🐛 Bug Hunter
- **Severity**: High
- **Category**: Journey dead-end / cost & trust
- **File**: `app/_components/voice/VoiceInterview.tsx:720-724` (the only error surface) and the failed-ending fall-through at `:689-698`
- **Scenario**: A candidate whose environment can't sustain the call (webview, mic hardware, persistent provider error) loops: preflight/error → retry → fail. There is no fallback path — no "email the recruiter", no "request a human call", no captured signal that this candidate hit a wall. They simply leave, and the recruiter never learns the link failed (the session may sit `created`/`failed` with no transcript, indistinguishable from "not yet taken").
- **Root cause**: The component treats every failure as locally retryable; there is no journey branch for "this candidate cannot complete the AI screen", and no telemetry/notification back to the recruiter on repeated failure.
- **Impact**: Silent candidate loss at the most fragile step, accessibility/fairness risk (the AI screen becomes a hard gate for anyone whose environment fails), and a support black hole. Directly tied to funnel value and to the consent/fairness story.
- **Fix sketch**: After N failed starts (count in a ref), swap the retry control for a "Trouble connecting? Continue without voice / contact the recruiter" affordance — at minimum a mailto/recruiter-contact line from session metadata; ideally a best-effort `fetch` flag on the session so the Schedule tab can surface "candidate hit a connection problem" instead of an ambiguous untaken link.
