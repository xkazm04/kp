# Biz+UI Scan — Data Layer, Schemas & Python Bridge (2026-06-12)

> Total: 5 (2H/2M/1L)

Prior findings re-verified as SHIPPED, not re-flagged: DATA1 retry (`app/api/tasks/[id]/retry/route.ts`), DATA2 ops panel (`app/api/ops/route.ts` + `SystemCard.tsx`), DATA3 backup/restore (`db-portability.ts` + `BackupCard.tsx`), DATA4 engine preflight (consumed by `AnalyzeForm.tsx:28` and `SchedulerControl.tsx:100` — the pre-run hints landed), DATA5 outcome drawer + unseen-failure badge, DATA6 filters. Bug-hunt 06-07 items 1–6 all fixed in current code (signal threading, `parsePythonJson` in analyze, `uq_tasks_active_dedupe` at `db.ts:546`, guarded mutators, bounded prune). Findings below are net-new gaps in the surfaces those waves created.

## 1. Re-run schema migrations after a workspace restore so an older backup can't brick the live app
- **Lens**: business_visionary
- **Severity**: High
- **Category**: functionality
- **File**: `app/_lib/db-portability.ts:163-180`
- **Scenario**: A recruiter takes a backup today, keeps working for a few weeks (during which an update adds columns the way every past migration did — e.g. `analyses.review_flags`, `pipeline_entries.source_campaign`), then restores that backup before a risky bulk action — the exact use the BackupCard advertises. The restore "succeeds", but History, dispositions, source analytics and any surface touching a post-backup column now throw `no such column` until someone restarts the server process. The card's own guidance — "Reload the page to see the restored workspace" (`BackupCard.tsx:87`) — cannot fix it: a page reload doesn't restart Node.
- **Root cause**: `loadWorkspace` drops each table and re-executes the DUMP's DDL (`db-portability.ts:166-167`) on its own connection, but the guarded `ALTER TABLE` migration pass lives only inside `ensureDb` (`db.ts:436-526`), which short-circuits on the cached singleton (`db.ts:128-129`, `_db = db` at 559) and is never invalidated — grep confirms no `_db = null`/reset path exists. The import route (`app/api/workspace/import/route.ts:42`) returns straight after `loadWorkspace` with no migration step.
- **Impact**: The backup feature's core promise — "restore is the undo button" — silently inverts for any dump older than the current schema: restoring it poisons the live workspace until an out-of-band server restart, which a recruiter-operator on a deployed box can't do. Trust in backups is binary; one such incident ends the feature's use.
- **Fix sketch**: Extract the ensureDb migration block (both ALTER arrays + the two guarded index creates, `db.ts:436-551`) into an exported `applyMigrations(db: Database)` and call it on the load connection at the end of `loadWorkspace`, after the transaction commits (each statement is already individually try/catch-guarded, so it is idempotent by construction). The dump format needs no change, and `db-load.mjs` can stay as-is since the CLI path is followed by a fresh boot anyway.

## 2. Snapshot the live workspace automatically before a replace-restore
- **Lens**: business_visionary
- **Severity**: Medium
- **Category**: user_benefit
- **File**: `app/api/workspace/import/route.ts:35-42`
- **Scenario**: The restore confirmation warns "These live tables already hold data and will be REPLACED" (`BackupCard.tsx:150-154`) — and the recruiter who picks the wrong file (yesterday's demo dump instead of this morning's backup) and clicks the red button loses today's pipeline work irreversibly. The all-or-nothing transaction protects against partial loads (`db-portability.ts:163-182`), but nothing protects against a *successful* wrong restore.
- **Root cause**: The apply branch calls `loadWorkspace` directly; `dumpWorkspace()` — the exact inverse, already in the same module (`db-portability.ts:53`) — is never invoked first, so the replaced rows are gone the moment the transaction commits. The feature's own rationale ("take a backup before a risky bulk action") isn't applied to its riskiest action.
- **Impact**: Single-tenant SQLite means there is no other copy: one mis-click in the only destructive dialog in the app is unrecoverable data loss of live candidate/pipeline state. An auto-snapshot turns the worst case from "lost a day of hiring work" into "restore the pre-restore file".
- **Fix sketch**: In the `apply: true` branch, before `loadWorkspace`, run `dumpWorkspace()` and write it to `tmp/pre-restore-<stamp>.json` (same `tmp/` home and stamp format the export route uses, `export/route.ts:19`); include `safetySnapshot: <path>` in the response and append it to the BackupCard `done` message ("Previous workspace saved to …"). Skip the snapshot when `plan.populated.length === 0` (nothing destructive). ~15 lines, no new endpoint.

## 3. Make the System card's spend numbers honest about their sampling window
- **Lens**: ui_perfectionist
- **Severity**: Medium
- **Category**: ui
- **File**: `app/features/tasks/SystemCard.tsx:98-102`
- **Scenario**: The card header promises "cost · cache · engines" (`SystemCard.tsx:47`) and renders "Tokens · 7d" as an authoritative weekly total. But a busy week — one screen wave writes one `pipeline.log` line per analyzed candidate (`pipeline/jobfit/logger.py:3`) — exceeds the read window, and the total silently shrinks to "tokens in the last ≤200 log lines / 256 KB", with no hint. The "Cache hit rate" cell discloses its basis ("`{sampled}` runs · 7d"); the tokens cell, the one a budget decision rides on, does not. And no cell anywhere shows actual currency: the Claude engine's per-call `total_cost_usd` is parsed and dropped (`pipeline/jobfit/claude_cli.py:283-289`), so the "7d tokens" figure is Gemini-only while reading as total spend.
- **Root cause**: `engineTelemetry` aggregates over `tailJsonl("pipeline.log")` which is hard-capped at `TAIL_BYTES = 256 * 1024` and `SAMPLE_LINES = 200` (`app/_lib/ops-telemetry.ts:11-12`, 77-102) — a deliberate boundedness tradeoff that the UI label then overstates. The undercount grows precisely when usage (and spend) peaks.
- **Impact**: The operator's only spend dashboard understates cost most when it matters most, and an operator who cross-checks against a Gemini bill will conclude the panel is broken — eroding trust in the whole System card.
- **Fix sketch**: (a) Surface the basis on the tokens cell like its siblings: `sub={`${data.engine.sampled} runs sampled · Gemini engine`}`; (b) in `engineTelemetry`, detect truncation (oldest sampled record still within 7d ⇒ window incomplete) and return a `partial: boolean` the cell renders as "≥" before the number; (c) optionally widen honestly — loop `tailJsonl` with a growing tail until the oldest record predates 7d or a 2 MB cap. A later step can persist per-run `cost_usd` from the Claude envelope into the same JSONL line to make the "cost" in the header true.

## 4. Give interactive AI actions a fast lane past long batch runs — and show queued tasks their place in line
- **Lens**: business_visionary
- **Severity**: High
- **Category**: feature
- **File**: `app/_lib/tasks.ts:32`
- **Scenario**: A recruiter kicks off "AI-screen all matched candidates" (one task holding a slot for the whole wave, `tasks.ts:59-77`) while an Analyze runs (Gemini-bound, up to the 10-minute `DEFAULT_TIMEOUT_MS`, `python-runner.ts:98`). Both `MAX_CONCURRENT = 2` slots are now taken. They then click "Why this candidate" or "Interview prep" — a 20-second interactive call — and it sits behind the batch indefinitely. The only feedback is the word "queued…" (`TasksTab.tsx:370`): no position, no reason, no ETA. To the recruiter mid-conversation with a hiring manager, the AI just stopped responding.
- **Root cause**: `pump()` drains one global FIFO under one global cap (`tasks.ts:210-215`), and the cap's own rationale is engine-specific — "respect the Claude CLI subscription rate ceiling" (`tasks.ts:32`) — yet Gemini-bound `analyze` tasks consume the same slots as Claude-bound `reasoning`/`group_eval`/`jd_build`/`interview_prep`, so the two engines' ceilings throttle each other and short interactive jobs queue behind long batch jobs with no priority distinction.
- **Impact**: Perceived reliability of the product's core differentiator ("AI on tap during hiring conversations") collapses exactly during heavy use — demo waves, Monday-morning screening. This is the reliability/visibility capability a recruiter notices missing first, and it needs no new infrastructure to fix.
- **Fix sketch**: Add `lane: "claude" | "gemini"` to the handler `Spec` (`tasks.ts:54-57`) and make `pump()` track per-lane running counts (2 each — Gemini's cap was never the subscription ceiling anyway), so an analyze can't starve reasoning and vice versa. UI half: the polled list already returns queued tasks in submission order (`listRecentTasks` orders active by `created_at ASC`, `db.ts:3185-3186`), so `ActiveCard` can render "queued · 2nd in line" by indexing into the active set — no API change.

## 5. Landing from the "N failed" badge should show the recruiter WHICH tasks failed
- **Lens**: ui_perfectionist
- **Severity**: Low
- **Category**: ui
- **File**: `app/features/tasks/TasksIndicator.tsx:33-50`
- **Scenario**: The sidebar badge says "3 background tasks failed since you last looked". The recruiter clicks it — and gets the full Background-tasks page: an In-progress group, a mixed Done list (up to 7 days of every kind), and no marker on the three new failures. Worse, the moment the tab opens, the ack effect stamps the watermark (`TasksIndicator.tsx:33-43`) and forces `unseenFailed` to 0 (`:44-45`), so even the count is gone before the user has located a single failed row.
- **Root cause**: The watermark exists only inside the indicator; `TasksTab` never receives it. The filter machinery that could isolate failures already exists (`FILTER_STATUSES` chips, `TasksTab.tsx:64, 152-164`) but nothing pre-applies it on a badge-driven open, and rows newer than the previous watermark get no "new" affordance.
- **Impact**: The DATA5 badge wins the recruiter's attention and then drops them at the doorstep — failure triage degrades back to visually scanning for red in a long list, which is the exact gap the badge was built to close.
- **Fix sketch**: Before overwriting the watermark, capture the previous `seenAt` and hand it to the tab (one-shot `sessionStorage` key, mirroring the `kp.tasksFailedSeenAt` localStorage convention). In `TasksTab`, when that hint is present, pre-select the "Failed" status chip (one `useState` initializer) and/or render a small coral "new" dot on failed/interrupted rows with `finishedAt > previousSeenAt` for the session. No API change; ~20 lines across the two components.

---
## Cross-checks performed
- Read both named prior reports: `feature-scout-2026-06-10/data-layer-python-bridge.md` (all 6 findings verified implemented as DATA1–DATA6 in current code); `feature-scout-2026-06-08/data-layer-python-bridge.md` does not exist. Also read `ui-bug-scan-2026-06-08/data-layer-schemas-python-bridge.md` and `bug-hunt-2026-06-07/data-layer-bridge.md` — every item verified fixed in current code; nothing above overlaps them.
- Grepped `_db = null|closeDb|resetDb` in `db.ts` — no singleton invalidation exists (finding 1).
- Grepped `engineAvailability` consumers — `AnalyzeForm.tsx:28` and `SchedulerControl.tsx:100` consume it, so the DATA4 pre-run-hint half shipped (deliberately NOT flagged).
- Grepped `cost_usd` — still parsed only in `claude_cli.py:283-289` + its test; folded into finding 3 as label evidence, not re-flagged as the DATA2 panel ask.
- Confirmed `uq_tasks_active_dedupe` exists (`db.ts:546`), `interview_prep` now threads `ctx.signal` (`tasks.ts:128`), `runOne`'s catch guards `finishTask` (`tasks.ts:250-259`).
- Read in full: `tasks.ts`, `python-runner.ts`, `db-portability.ts`, `ops-telemetry.ts`, `engine-preflight.ts`, `useJsonFetch.ts` (one-shot fetch confirmed), `claude_cli.py`, `TasksTab.tsx`, `TasksIndicator.tsx`, `TasksProvider.tsx`, `SystemCard.tsx`, `BackupCard.tsx`, all 4 `api/tasks` routes, `api/ops/route.ts`, both `api/workspace` routes; `db.ts` task/migration/count sections (100-160, 295-330, 425-565, 3140-3315); `logger.py` header + `pipeline.py:294`.
