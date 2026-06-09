# UI+Bug Scan — Fix Wave 4: Concurrency & idempotency

> 6 findings closed (4 High, 2 Medium) across 5 atomic commits.
> Baseline preserved: tsc 0 → 0, next build ✓, unit 638 → 638, lint clean.
> One mental model: **exactly-once — atomic guards + correct terminal-state.**

## Commits

| # | Commit | Finding | Severity | Files |
|---|---|---|---|---|
| 1 | `00a9423` | concurrent outreach double-sends the candidate | High | automation-run.ts |
| 2 | `1143a0a` | devcase approved stage non-idempotent (dup posting) | High | devcase-orchestrator.ts |
| 3 | `c7e6fea` | OpenAI hang-up locks "completed" forever | High | VoiceInterview.tsx |
| 4 | `c7e6fea` | OpenAI never sets reachedLiveRef (lost beacon) | High | VoiceInterview.tsx |
| 5 | `5d8813e` | already-promoted submission re-exposes Promote | Medium | SubmissionRow.tsx, EvalPanel.tsx |
| 6 | `76222af` | forced tick double-advances the clock | Medium | automation-pass.ts, scheduler.ts |

(Findings 3 & 4 ship in one commit — both are OpenAI-path edits in VoiceInterview.tsx, and #4's `reachedLiveRef` is a prerequisite for #3's terminal-status helper.)

## What was fixed (grouped by sub-pattern)

### Check-then-act idempotency (marker written after the side effect)
1. **outreach double-send** — `hasEvent("outreach_sent")` gated a send whose marker was recorded only *after* sendComm, so two concurrent calls both passed and double-sent. A per-entry in-process single-flight (mirroring the pass's inFlightPass) now blocks a concurrent send and releases on completion/failure (so the durable marker, written only on success, still permits a retry).

### Side-effecting "resumable" stage with the completion marker last
2. **devcase dup posting** — the `approved` handler `publish()`-ed (mint posting + token, no caseId dedup) then flipped to `collecting` only at the end; a crash in between re-published on resume, orphaning a posting. publish now runs only when there's no postingId yet, and the id persists immediately so a resume reuses it.

### Asymmetric / hardcoded terminal-state
3. **OpenAI hang-up lockout** — `end()` hardcoded `finalize("completed")`, so a zero-turn OpenAI hang-up wrote a terminal completed (empty transcript) and locked the candidate out, while the EL path returns "failed" and stays reconnectable. `end()` now derives the status via `interviewFinalStatus` like EL.
4. **OpenAI lost beacon** — go-live never set `reachedLiveRef`, so the unmount transcript beacon (gated on it) skipped OpenAI — a live call lost on tab-close. Now set at go-live inside the still-current-connection guard (also feeds #3's status helper).

### Stale-client / in-flight double-action
5. **duplicate promote** — the Promote button read only a local `useState(false)`, re-appearing for a submission already promoted (pre-reload or lifecycle auto-promote) and re-firing /promote. Promoted is now `local || submission.status === "promoted"`, with an in-flight guard + disabled "Promoting…" state.

### Single-flight dedupes work but not bookkeeping
6. **forced-tick double-advance** — a forced tick that JOINED an in-flight pass still ran `advanceAfterForcedRun()` + `recordRun()`, pushing next_due_at an extra interval and logging a duplicate run. tickScheduler now captures `isPassInFlight()` before the call and only advances/records when this tick actually starts the pass.

## Verification (before / after)

| Gate | Baseline (B2) | After Wave 4 |
|---|---|---|
| tsc --noEmit | 0 errors | 0 errors |
| next build | ✓ | ✓ (Compiled successfully) |
| test:unit | 638 pass | 638 pass |
| eslint (touched files) | — | clean |

No regressions.

## Cumulative status (waves 1–4)

| Wave | Theme | Closed |
|---|---|---|
| 1 | Trust-boundary & validation (security) | 8 |
| 2 | Data integrity (lost-updates & dropped writes) | 7 |
| 3 | Identity-by-label / wrong-record | 5 |
| 4 | Concurrency & idempotency | 6 |
| | **Total** | **26** |

All 3 scan criticals + the correctness core (security, data integrity, identity, concurrency) are closed. **57 findings remain across 5 themes** (mostly Medium/Low reliability-UX + polish).

## Patterns established (catalogue items 12–15)

12. **Check-then-act idempotency with the marker written after the side effect.** A `hasEvent`/flag gate whose durable marker is recorded only after the awaited side effect double-fires under concurrency. Claim before the await (in-process single-flight or atomic insert) and release on failure so a real retry still works.
13. **Side-effecting "resumable" stage with the completion marker written last.** A non-idempotent external action (publish/allocate id+token) inside a resumable stage that persists completion only at the end re-runs on crash/restart. Persist the side-effect's id immediately and guard re-entry on it.
14. **Single-flight dedupes work but not bookkeeping.** A joiner shares the in-flight result, but per-caller side effects (advance a clock, write a log row) still run twice. Detect started-vs-joined and do bookkeeping only for the starter.
15. **Asymmetric terminal-state across parallel branches.** One branch hardcodes a terminal outcome ("completed") while the sibling derives it from real signals; a zero-progress end then locks the resource. Single-source the terminal-status decision across both branches.

## What remains

57 findings across 5 themes (INDEX). Recommended next: **Wave 5 — Stale UI / fetch-state** (board refresh after a background clock pass, scheduler-poll reload, recruiter-candidates job-switch, analytics retry, re-weight loading state, `useJsonFetch` 204, sim getEntries non-OK, stage "+N more" reset) — ~8 fixes sharing "keep views fresh; surface fetch errors with retry."
