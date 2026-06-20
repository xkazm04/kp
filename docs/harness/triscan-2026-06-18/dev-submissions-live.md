# Dev Submissions & Live Work Surface — Tri-Lens Scan
> Total: 5
> Severity: 1 Critical / 3 High / 1 Medium / 0 Low
> Lens: 3 bug / 1 ui / 1 biz

## 1. Live-session submissions are scored as if no work history exists — the flagship authenticity signal is thrown away
- **Lens**: 🐛 Bug Hunter (primary) · also 🚀 Business Visionary
- **Severity**: Critical
- **Category**: Authenticity scoring / success-theater / data loss
- **Value**: impact 9/10 · effort 4/10 · risk 3/10
- **File**: `app/_lib/devcase-run.ts:446-514`, `app/_lib/devcase-authenticity.ts:39-85`
- **Scenario**: A candidate does the whole case in the in-product Live Work Surface — opens files, edits incrementally, writes `DECISIONS.md` live (all captured as observed `decision_log`/`edit`/`open` events). On submit, `repoRef = "session:<id>"`, so `signals` stays `null`. `processTrace` becomes `{ commitCount: 0, cadence: null, decisionsLogPresent: (signals?.topLevel ?? []).some(...) = false }`. `scoreAuthenticity` then docks −15 (no commit history) and −25 (DECISIONS missing) → score 60, band "mixed". A live-WATCHED submission — the single strongest proof of genuine authorship the product has — is permanently capped below "authentic" and can read as half-suspect.
- **Root cause**: The observed event stream + editable file tree are written to disk for the Python CLI (line 491) but are NEVER folded back into `processTrace`/`authenticity`. `decisionsLogPresent` only inspects `signals.topLevel` (git), which is null for sessions; commit cadence is the git path only. The "observed > inferred" promise (EvalPanel line 125-138) is true for the *tooling* chip but the authenticity score silently contradicts it.
- **Impact**: The headline differentiator ("we grade the judgment we WATCHED") actively penalizes the candidates who used it; recruiters distrust the cleanest signals. Self-inflicted false-suspicion on real, observed work.
- **Fix sketch**: For session submissions derive the trace from events: `commitCount`/cadence from the edit-event timeline, `decisionsLogPresent` from any `decision_log` event OR a `DECISIONS.md` entry in the saved file tree. Feed an `observed: true` flag into `scoreAuthenticity` so the no-commit-history penalty is waived when work was watched live.

## 2. `submitDevSession` finalize is a read-then-write race — a double-click can mint two submissions for one session
- **Lens**: 🐛 Bug Hunter
- **Severity**: High
- **Category**: Idempotency / double-submit race
- **Value**: impact 6/10 · effort 3/10 · risk 3/10
- **File**: `app/_lib/db/devcase.ts:576-589`; client trigger `app/devcase/apply/[token]/LiveWorkSurface.tsx:110-121`
- **Scenario**: `submitDevSession` does `if (session.submissionId) return existing;` then `createSubmission(...)` then `UPDATE ... SET submission_id = ?` — three statements, no transaction. The `submit()` client handler sets `status="submitting"` and disables the button, but the network call to `/session/[id]/submit` is fired without an in-flight ref; React state batching + a fast double Enter/click can dispatch two POSTs before the first response. Both reads see `submissionId = null`, both call `createSubmission`. Because the session repoRef is unique (`session:<id>`), the `(posting,candidate,repo)` dedup index coalesces them to ONE row — so today it's saved by the unique index, not by this function. But `candidateRef` defaults to `"live-session"`, so if two *different* sessions for the same posting both fall back to that literal with the same repo pattern... (they don't collide because repoRef embeds the id). The real exposure: the non-atomic update means a crash between INSERT and UPDATE leaves a session permanently "active" with an orphan submission and no `submission_id` link, so a retry creates a second submission row.
- **Root cause**: Finalize spans three statements outside a transaction; client has no request-level in-flight guard (only a status flag set in the same tick).
- **Impact**: Orphaned submissions / sessions stuck active; duplicate review cards in edge cases; lifecycle resume fired twice.
- **Fix sketch**: Wrap the read-create-update in a single `db.transaction`, re-checking `submission_id` inside it; add an in-flight `useRef` guard in `submit()` so a second click before resolution is a no-op.

## 3. Live-session submissions never capture contact — every live candidate is "unreachable if promoted"
- **Lens**: 🚀 Business Visionary (primary) · also 🐛 Bug Hunter
- **Severity**: High
- **Category**: Journey dead-end / data gap
- **Value**: impact 7/10 · effort 3/10 · risk 2/10
- **File**: `app/_lib/db/devcase.ts:581-585`, `app/devcase/apply/[token]/LiveWorkSurface.tsx:18-121`
- **Scenario**: The Live Work Surface mints a session with `token` only (no name, no email). `submitDevSession` creates the submission with `candidateRef: "live-session"` and no `contact`. The recruiter row then shows the amber "No contact — unreachable if promoted" warning (SubmissionRow.tsx:307-313) for EVERY live submission. A candidate can do excellent watched work and the recruiter cannot reach them — and the candidate gets no acknowledgement email (intake comms key off `contact`). The Live Surface is the product's moonshot, yet it produces structurally undeliverable candidates.
- **Root cause**: `LiveWorkSurface` collects zero identity; `startDevSession`/`session` route accept an optional `candidateRef` that the client never sends, and there is no contact field at all.
- **Impact**: The flagship surface yields anonymous, unreachable submissions; recruiter must chase identity out-of-band; candidate hears nothing back.
- **Fix sketch**: Add a lightweight name+email gate before/at submit in `LiveWorkSurface` (mirror DevApplyForm's `contactValid` check), pass `candidateRef`/`contact` to `startDevSession` and through `submitDevSession` → `createSubmission`, so live submissions are deliverable and acknowledged like form submissions.

## 4. Authenticity score has no candidate-facing visibility and the recruiter chip is unreadable at a glance
- **Lens**: 🎨 UI Perfectionist
- **Severity**: Medium
- **Category**: UI clarity / trust signal
- **Value**: impact 5/10 · effort 3/10 · risk 2/10
- **File**: `app/features/sub_dev/EvalPanel.tsx:78-95`
- **Scenario**: The authenticity verdict is a single `authenticity 60` pill whose band (suspect/mixed/authentic) is conveyed by color alone, with the reasons buried in a `title` tooltip. A colorblind reviewer can't distinguish coral-suspect from amber-mixed; the number "60" carries no scale or band word in the visible text. Because the band drives the auto-promote HOLD (devcase-run.ts:607,625), a recruiter scanning the row cannot see WHY a strong-fit candidate was held without hovering. There is also no text alternative / `aria-label` on the pill, so a screen reader announces a bare number.
- **Root cause**: Band encoded only as background color; reasons + scale only in `title`; no visible band label or accessible name.
- **Impact**: The product's anti-cheat differentiator is hard to read and inaccessible; HOLD decisions look arbitrary; weakens recruiter trust in the score.
- **Fix sketch**: Render the band word in the pill text (e.g. "authenticity 60 · mixed"), add `aria-label` summarizing band+score+top reason, and surface the top 1-2 reasons inline (not tooltip-only) when band is suspect/mixed.

## 5. Untrusted candidate repoRef drives unauthenticated GitHub fetches with no per-token rate limit (snapshot abuse / SSRF-adjacent)
- **Lens**: 🐛 Bug Hunter
- **Severity**: High
- **Category**: Untrusted-input handling / resource abuse
- **Value**: impact 6/10 · effort 4/10 · risk 4/10
- **File**: `app/_lib/repo-snapshot.ts:71-217`, reached via `app/_lib/devcase-run.ts:451`; inbound at `app/api/devcase/inbound/route.ts:41-51`
- **Scenario**: The public inbound webhook accepts any `repoRef` string (only "candidate and repoRef required" — no shape check at the boundary). `parseRepoRef` does correctly enforce GitHub's owner/repo grammar (good — blocks path-traversal/confused-deputy), but a valid-looking `owner/repo` then triggers up to ~3 + `statsDepth` (12) sequential `api.github.com` calls per evaluation, using the server's shared `GITHUB_TOKEN`. There is no rate limit on `/api/devcase/inbound` or on evaluation, and `intakeSubmission` is idempotent per `(posting,candidate,repo)` but a caller can vary `candidate`/`repo` freely to enqueue unbounded distinct submissions, each of which (on evaluate) burns the org's GitHub quota and CLI/LLM spend. A token holder (or anyone who guesses one open posting's 128-bit token from a shared link) can drain GitHub rate limit + LLM budget for the whole tenant.
- **Root cause**: No request rate limiting on the public intake/eval path; per-submission GitHub fan-out is unbounded across submissions; the shared server token amplifies one caller's input into org-wide quota consumption.
- **Impact**: A single leaked apply link → denial-of-wallet (LLM/CLI cost) and GitHub rate-limit exhaustion that blocks legitimate evaluations across the workspace.
- **Fix sketch**: Add a per-token (and per-IP) rate limit to `/api/devcase/inbound` (a `rate-limit.ts` helper already exists in `_lib`); cap submissions-per-posting-per-window; and short-circuit `buildRepoSnapshot`/`fetchRepoSignals` behind a per-repo TTL cache so re-evaluations and duplicate repos don't re-fan-out.
