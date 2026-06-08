# Feature Scout — Voice Interview Runtime (kp)

> Total: 6 opportunities (High: 3, Medium: 2, Low: 1)
> Files read: ~18

Scope traced end-to-end: recruiter mints a session (`/api/interview/create` ← `ScheduleTab.startInterview`), the candidate runs the live call (`VoiceInterview.tsx` ↔ `/connect` ↔ provider adapters), the transcript is POSTed on hang-up (`/complete`) and scored (`runInterviewScorecard`), then the recruiter reviews it (`InterviewTranscriptModal`, `CompareInterviews`). The runtime itself is mature (consent gating, idempotent completion, asymmetric-turn capture, telemetry, observed-skill minting). The gaps below are all at the *edges* of that loop — getting the candidate INTO the call, what the recruiter can do DURING it, and turning the captured transcript into navigable signal AFTER it.

---

## 1. Deliver the tokenized interview link to the candidate (it never leaves the recruiter's browser)

- **Value**: High
- **Category**: integration
- **Effort**: S
- **Where it slots in**: `app/features/sub_schedule/ScheduleTab.tsx:129` — `window.open(d.url, "_blank")` after `/api/interview/create`; delivery layer at `app/_lib/comms-dispatch.ts:127` (`dispatchInterviewReminder`)
- **Gap**: `startInterview` opens the freshly minted `/interview/<token>` link in the *recruiter's* own new tab — the candidate is never sent it. The existing `dispatchInterviewReminder` (`comms-dispatch.ts:127`) emails a generic "your interview is coming up at <slot>" with **no link in the body**. There is no path that puts the AI-screen URL in front of the candidate.
- **Opportunity**: On "Start AI interview", instead of (or in addition to) opening the tab, `sendComm` the tokenized link to the candidate via the existing comms channel — "Your AI first-round screen for <role> is ready: <link>. Takes about <durationMin> min." Reuse `candidateRecipient(entry)` and the `durationMin` already on the session.
- **Why it matters**: Today the product literally cannot invite a remote candidate to the voice screen without the recruiter manually copying a URL — the headline feature is undeliverable end-to-end.
- **Sketch**: Add `dispatchInterviewInvite(entry, url, durationMin)` beside `dispatchInterviewReminder` in `comms-dispatch.ts`; call it from `/api/interview/create` (server-side, where the token is minted) or from `startInterview`. Record an `interview_invite_sent` automation event like the reminder does.

## 2. Recruiter live co-pilot — watch the AI interview transcript in real time

- **Value**: High
- **Category**: feature
- **Effort**: M
- **Where it slots in**: `app/features/sub_schedule/ScheduleTab.tsx:100-116` (already polls `/api/interview/by-entry` every 6s for `status === "in_progress"`); `InterviewPrepModal.tsx:167` (static checkable run-of-show)
- **Gap**: The recruiter has a checkable run-of-show in `InterviewPrepModal`, but it is wholly static — it never shows what the AI is actually asking or what the candidate is saying. While the call is `in_progress` the recruiter can only see the words "Interview in progress" (`ScheduleTab.tsx:262`); the live transcript exists only in the candidate's browser and isn't persisted until `/complete`.
- **Opportunity**: A live monitor pane: stream/poll the in-flight transcript so the recruiter watches the AI screen unfold against the run-of-show, with the prep checklist auto-ticking as topics are covered. (Read-only first; barge-in is a later step.)
- **Why it matters**: Turns the AI from a black box the recruiter trusts blindly into a supervised first round — the recruiter can catch a derailed conversation, and the prep checklist becomes live rather than aspirational.
- **Sketch**: Have the client periodically POST partial turns (or open an SSE the recruiter subscribes to keyed by `sessionId`); render in a new modal that reuses `InterviewTranscriptModal`'s turn renderer. The 6s poll + focus-refresh plumbing in `ScheduleTab` is already there to extend.

## 3. Link scorecard evidence quotes to the transcript turns they came from

- **Value**: High
- **Category**: user_benefit
- **Effort**: M
- **Where it slots in**: `app/features/sub_schedule/InterviewTranscriptModal.tsx:82-107` (scorecard ratings + `r.evidence`) and `:117-133` (flat transcript list)
- **Gap**: The scorecard shows each rating with a verbatim `evidence` string, and below it the full transcript — but the two are disconnected. A recruiter validating a "2/5 — communication" rating must eyeball-scan the whole transcript to find the moment behind the quote. `CompareInterviews.tsx:184` surfaces the same evidence quotes with the same no-anchor limitation.
- **Opportunity**: Make each evidence quote a clickable anchor that scrolls to / highlights the matching transcript turn (substring match on `t.text`), and badge transcript turns that a rating cites. Optionally add per-turn timestamps (already on `VoiceTurn.at`, `voice/types.ts:58`) so the recruiter sees pacing.
- **Why it matters**: The quotes ARE the scorecard's accountability (the code says so at `CompareInterviews.tsx:182`). Letting a recruiter jump from a contested rating straight to its source turns "trust the AI" into "verify the AI in one click" — decisive at the Interview→Offer gate.
- **Sketch**: In the modal, index transcript turns; for each `r.evidence`, find its turn by longest-substring match, render the rating as a button that sets a `highlightTurnIdx` and `scrollIntoView`s it. Pure client change; no API/schema work.

## 4. Auto-summarize the transcript into a "what happened" digest above the raw replay

- **Value**: Medium
- **Category**: automation
- **Effort**: M
- **Where it slots in**: `app/_lib/interview-run.ts:248` (`runInterviewScorecard`, already runs an LLM task over the transcript at `/complete`); surfaced in `InterviewTranscriptModal.tsx:73-108`
- **Gap**: The scorecard yields ratings + a one-line `sc.summary`, but the recruiter who wants the *narrative* — what was asked, where the candidate excelled or stumbled, notable quotes, open follow-ups for a human round — still reads the entire raw transcript turn by turn. There is no structured highlight/summary artifact.
- **Opportunity**: Extend the scorecard synthesis (or add a sibling task) to emit a short structured digest — 3-5 highlights, suggested human-round follow-ups, a strengths/concerns split — persisted alongside the scorecard and rendered as a collapsible header in the transcript modal.
- **Why it matters**: A recruiter triaging a queue of completed screens needs 20 seconds per candidate, not a 20-minute transcript read; the digest is what makes the voice round scale past a handful of candidates.
- **Sketch**: Add fields to the scorecard prompt/schema in the `scorecard` automation task (`interview-run.ts:264`), or a new `interview_digest` task run best-effort after persistence (same pattern as telemetry/observed-skills enrichment, which already ride the scorecard at `:271`/`:289`). Render above the ratings section in `InterviewTranscriptModal`.

## 5. Per-role / per-session multi-language beyond the hardcoded cs/en pair

- **Value**: Medium
- **Category**: functionality
- **Effort**: M
- **Where it slots in**: `app/_components/voice/VoiceInterview.tsx:27` (`type LangHint = "auto" | "cs" | "en"`) and the toggle at `:556-561`; brief composer at `interview-run.ts:58-60` (Czech grammatical forms hardcoded into instructions)
- **Gap**: The language picker is a fixed three-button `auto | Čeština | English`, and `composeBrief`/`composeDebriefBrief` bake "Detect whether the candidate speaks Czech or English" plus Czech masculine-form instructions directly into every interviewer brief. `coerceLanguage` (`voice/types.ts:25`) already validates *any* BCP-47-ish tag, and both provider adapters accept a `language`, so the runtime is wider than the UI exposes.
- **Opportunity**: Drive the offered languages from session/job config rather than a hardcoded pair — let a role declare its interview languages, render the picker from that list, and parameterize the brief's language sentence so the agent isn't told to assume Czech-or-English for a, e.g., German or Polish candidate.
- **Why it matters**: The validation and adapter plumbing already supports arbitrary languages; the only thing pinning the product to two is UI + prompt copy. Unlocking this widens the addressable candidate pool with minimal runtime risk.
- **Sketch**: Replace the literal `LangHint` triple with a list sourced from the job/session; thread it through `/create` (it already stores `language`); template the language clause in `composeBrief` (`interview-run.ts:56-64`).

## 6. Candidate accommodations — extended time, text fallback, and a pre-call mic/audio check

- **Value**: Low
- **Category**: feature
- **Effort**: M
- **Where it slots in**: `app/interview/[token]/page.tsx:58-70` (portal) + `app/_components/voice/InterviewSidebar.tsx:47-66` ("Before you start" tips); preflight already exists at `VoiceInterview.tsx:18,428`
- **Gap**: The portal gives readiness *tips* (quiet spot, headphones, allow mic) and a fail-fast preflight error, but offers the candidate no actual accommodations: no working mic/levels test before the call starts, no extended-time option, and no text/typed fallback for a candidate who can't do live voice (accessibility or a noisy environment). `voicePreflightError` only blocks doomed environments; it doesn't help a candidate who passes preflight but isn't ready.
- **Opportunity**: A pre-call "test your mic" step (visualize input level before consuming a `/connect` credential), a flag for a longer-duration variant, and a typed-answer fallback mode for candidates who request it.
- **Why it matters**: An AI-only voice gate with no alternative is an accessibility and fairness liability for a hiring tool; even a mic-check materially cuts failed-call retries (the most common real-world first-round failure the preflight comment at `VoiceInterview.tsx:424` already calls out).
- **Sketch**: Add a `getUserMedia` level meter component shown before "Start the call" (reuses the mic stream `startOpenAi` acquires); gate it behind the existing consent step. Extended-time = a duration variant on the session; text fallback is a larger lift (would render the brief's questions as a form) — scope the mic-check first.
