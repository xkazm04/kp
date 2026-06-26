# Dev Submissions & Live Work Surface — Ambiguity 🌀 + Business 🚀 scan
> Total: 5 | Lens: 🌀3 / 🚀2 | Severity: C1/H2/M2/L0

## 1. Live Work Surface is paste-blind — the authenticity moat has a hole
- **Lens**: 🚀 Business
- **Severity**: Critical
- **Category**: competitive-moat / silent-wrong-outcome
- **File**: app/devcase/apply/[token]/LiveWorkSurface.tsx:112
- **Observation**: `onEdit` records a single debounced `"edit"` event per file (LiveWorkSurface.tsx:112-118) regardless of whether one character was typed or 500 lines were pasted from ChatGPT — the file header even states "We observe process artifacts only — never keystrokes" (LiveWorkSurface.tsx:11), and there is no `onPaste`/edit-magnitude capture. Worse, `scoreAuthenticity` deliberately *waives* the no-commit-history penalty for observed sessions (devcase-authenticity.ts:54,60 + devcase-run.ts:470,487), so a candidate who pastes a whole LLM solution into the textarea and clicks Submit scores **100/100 "authentic"**. The strongest authorship proof the product claims (the whole reason the Live Work Surface exists) is defeated by Ctrl-V.
- **Why it matters**: The module's own thesis is "every recruiter now fears take-homes are ghost-written by an LLM" (devcase-authenticity.ts:2) and watched live-work is the moat vs HackerRank/CodeSignal. A pasted answer rendering as an "authentic 100" badge is a silent wrong hiring signal — the one place the product promises it cannot be fooled is exactly where it is most foolable.
- **Recommendation**: Add paste/edit-size telemetry to the event stream (a `paste` kind + per-edit char delta in the session POST), and feed a "bulk-insert with no incremental build-up" penalty into `scoreAuthenticity` for observed sessions so a single large paste cannot reach the "authentic" band. This re-arms the differentiator and is genuinely sellable ("paste-from-LLM detection").
- **Effort**: M

## 2. No timebox enforcement, lost-work guard, or abandoned-session handling
- **Lens**: 🌀 Ambiguity
- **Severity**: High
- **Category**: edge-case / happy-path-only
- **File**: app/devcase/apply/[token]/LiveWorkSurface.tsx:98
- **Observation**: The case carries a `timeboxHours` (AnalysisView.tsx:152) shown to the candidate as advisory brief text, but the surface enforces nothing: no countdown, no auto-submit at the limit, no `beforeunload` warning, and edits only flush every `FLUSH_MS = 8000` (LiveWorkSurface.tsx:15,98-104) — an undocumented magic number whose trade-off (up to 8s of unsaved work lost on tab close, since the keepalive flush only fires on the explicit Submit) is unrecorded. Sessions are minted `'active'` (db/devcase.ts:518) with no expiry and no cleanup path; an abandoned session never becomes a `dev_submissions` row, so the recruiter never sees that the candidate started — a silent ghost.
- **Why it matters**: Candidates lose work on a flaky network/closed tab and recruiters lose visibility into drop-off. "Queued, never ghosts" is a stated product value (inbound/route.ts:32) yet an abandoned live session ghosts by construction. The timebox is a documented requirement that is never operationalized — pure tribal knowledge.
- **Recommendation**: Add a visible countdown from `timeboxHours` with auto-submit (or auto-finalize) at expiry, a `beforeunload` flush, and a background sweep that finalizes/marks stale `active` sessions so partial work surfaces. Document the FLUSH_MS data-loss window.
- **Effort**: M

## 3. Observed event stream is captured but never replayed to the recruiter
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: dark-capability / value-left-on-the-table
- **File**: app/_lib/db/devcase.ts:530
- **Observation**: Every live session persists a rich, timestamped, append-only event log — file opens, edits, decision-log entries, submit — via `getDevSessionEvents` (db/devcase.ts:530-536) and `dev_session_events` (db/core.ts:375). But the recruiter UI consumes it only as a single binary chip: "observed" vs "inferred" (EvalPanel.tsx:127-138). The minute-by-minute story of *how the candidate actually worked* is sitting in the DB, unused.
- **Why it matters**: A session-replay timeline ("opened the seam file at 0:04, edited DECISIONS at 0:18, first solution edit at 0:25") is exactly the kind of proctoring/process-evidence artifact HackerRank and CodeSignal charge premium for — and kp already collects the data. Surfacing it is a headline differentiator and a credible premium tier; leaving it as a 9-character chip is value left on the table.
- **Recommendation**: Add a recruiter-facing "Replay session" timeline rendered from the existing events (no new capture needed), and consider it a paid "verified process" feature.
- **Effort**: M

## 4. Authenticity conflates an unreadable/private repo with a suspicious process
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: missing-data-vs-signal / fairness
- **File**: app/_lib/devcase-authenticity.ts:60
- **Observation**: For a normal (non-observed) submission whose GitHub fetch fails — private repo, bad token, rate limit — `signals` is null, so `commitCount` is 0 and `decisionsLogPresent` derives from an empty `topLevel` (devcase-run.ts:474-476). `scoreAuthenticity` then docks −15 "No readable commit history" (line 60) **and** −25 "Mandated DECISIONS log is missing" (line 66), landing ~60 → band "mixed" with candidate-neutral reasons that read as process concerns. "We couldn't see it" is scored identically to "the process looks thin."
- **Why it matters**: A competent candidate with a private/enterprise repo is silently flagged "mixed authenticity" for an infrastructure reason, and the recruiter sees process-doubt language with no signal that the data was simply unavailable. That is an undocumented assumption baked into a hiring-influencing band.
- **Recommendation**: Distinguish "data unavailable" (fetch returned null) from "data present but thin." Emit an explicit `unreadable` reason and either abstain from the band or label it "unscored — repo not readable" rather than penalizing into "mixed."
- **Effort**: S

## 5. Side-by-side compare silently caps at the top 5 and reports the capped count
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: hidden-truncation / contract-not-honored
- **File**: app/_lib/devcase-compare.ts:50
- **Observation**: `rubricCompare` caps the matrix at `maxColumns = 5` (devcase-compare.ts:50-55) and its doc explicitly says "`maxColumns` caps the matrix width … the caller reports the true count" (lines 45-46). But the only caller, `CompareSubmissions`, calls it with no override (CompareSubmissions.tsx:19) and renders `· {columns.length}` (CompareSubmissions.tsx:29) — i.e. the *capped* 5, never the true number of evaluated submissions. With 8 evaluated candidates, 3 vanish from the comparison with no indication.
- **Why it matters**: A reviewer making a head-to-head hiring call believes they are comparing all evaluated candidates when 3 of 8 are silently dropped (and the dropped ones are the lower-fit, not necessarily lower on a specific axis like architecture). The documented contract — caller surfaces the true count — is unmet, so the omission is invisible.
- **Recommendation**: In `CompareSubmissions`, compute the true evaluated count and show "top 5 of N" when truncated; optionally let the reviewer page/expand the matrix.
- **Effort**: S
