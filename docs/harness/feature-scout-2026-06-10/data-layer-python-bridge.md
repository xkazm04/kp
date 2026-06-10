# Feature Scout — Data Layer, Schemas & Python Bridge (2026-06-10)

> Total: 6 (3H/2M/1L)

## 1. Retry a failed or interrupted background task with one click
- **Value**: High
- **Category**: functionality
- **Effort**: S
- **Where**: `app/features/tasks/TasksTab.tsx:281-306` (`DoneRow` — error text, no action) (+ `app/_lib/tasks.ts:174-193` `startTask`, `app/api/tasks/[id]/route.ts:7-12` full-record GET, `instrumentation.ts:23-28` interrupt-on-boot)
- **Gap**: Every task's `params_json` is durably persisted (`tasks` table, `db.ts:265-280`) and `GET /api/tasks/[id]` returns it in full — yet a `failed`/`interrupted` row is a dead-end: the recruiter must navigate back to the originating surface and rebuild the request by hand. `interrupted` is routine, not exotic: every server restart/crash marks in-flight rows interrupted (`instrumentation.ts`), so an overnight batch screen or a long analyze run dies with its inputs sitting unused in the DB.
- **Proposal**: Add `POST /api/tasks/[id]/retry`: load the row server-side, validate `isKnownKind`, and call `startTask(task.kind, task.params)` (server-side so multi-MB params never round-trip through the client; `buildDedupeKey` already makes a double-click merge into the in-flight run). Surface a "Retry" button on `failed`/`interrupted`/`canceled` rows in `DoneRow` (live list + history), flipping the row into the In-progress group via the existing 2s poll. Exclude kinds whose params reference vanished temp files if any (analyze persists file content into params? verify per-kind; grey out with a tooltip where replay is impossible).
- **Why users need it**: A failed group evaluation or AI-screen wave today costs a full manual reconstruction of the request; the system already holds everything needed to replay it.

## 2. Surface LLM cost, cache and pipeline telemetry in a System/Ops panel
- **Value**: High
- **Category**: user_benefit
- **Effort**: M
- **Where**: `app/api/health/route.ts:10-45` (zero in-app consumers — curl-only) (+ `app/_lib/logger.ts:37-54` `cache_hit`/duration per analyze, `pipeline/jobfit/logger.py:19-43` + `pipeline/jobfit/pipeline.py:271-286` per-stage timings + Gemini token usage to `tmp/pipeline.log`, `pipeline/jobfit/claude_cli.py:281-289` `cost_usd`/`usage` parsed then discarded by every caller, `app/_lib/db.ts:801-865` prompt cache)
- **Gap**: The app meticulously collects ops telemetry — Gemini prompt/candidate/cached token counts per analysis, per-stage timings, cache hit/miss flags, comms dead-letter records — and then writes all of it to append-only JSONL files in `tmp/` that **nothing reads**. `ClaudeResult` even parses `total_cost_usd` and token usage from the CLI envelope and every call site drops them. The prompt cache (`gemini_cache`) has no visible size or hit-rate. `/api/health` exists but no UI fetches it. Operators fly fully blind on spend, cache effectiveness, and degradation.
- **Proposal**: Add `GET /api/ops`: the health payload + prompt-cache stats (row count, expired backlog via a small `countPromptCache()` helper, hit-rate computed from a bounded tail of `analyze.log`), token totals + average stage timings from a bounded tail of `pipeline.log`, and the in-process counters that already exist (`getScheduleReconcileCount`, `getScheduleNoSlotsCount`, dead-letter count from `comms.log` tail). Render a "System" card on the Background-tasks tab (the operator's natural home): cache hit-rate, tokens spent this week, avg analyze duration by stage, queue depth, seed health + `degradedReasons`. Read-only; logs are line-delimited JSON so a tail-N reader is ~30 lines.
- **Why users need it**: "Is the cache even working?", "what is grounding costing us?", and "why is everything slow today?" are currently answerable only by grepping `tmp/` on the server box.

## 3. Back up and restore the workspace from the UI
- **Value**: High
- **Category**: feature
- **Effort**: M
- **Where**: `scripts/db-dump.mjs:1-123`, `scripts/db-load.mjs:1-126`, `package.json:23-24` (`db:dump`/`db:load` — npm-only, no UI or API caller) (+ `app/_lib/export-utils.ts` `downloadFile` precedent, `app/_lib/db-path.ts`)
- **Gap**: A complete, versioned, all-tables portable dump/restore already exists — DDL + rows, BLOB-safe, all-or-nothing transactional load, refuse-to-clobber semantics — but it is reachable only from a terminal on the server machine. A recruiter/demo operator cannot snapshot the workspace before a risky bulk action (screening wave, automation pass, `--replace` restore), move a workspace between machines, or hand a colleague a reproducible demo state without a developer.
- **Proposal**: Extract the dump/load cores into `app/_lib/db-portability.ts` (the `.mjs` scripts stay as thin bare-node callers or keep their own copy — they can't import TS) and add `GET /api/workspace/export` (streams the dump JSON, `--skip gemini_cache,tasks` defaults) + `POST /api/workspace/import` (upload, dry-run summary of populated tables, explicit "replace" confirmation preserving db-load's all-or-nothing transaction). UI: a "Backup & restore" card beside the System panel (#2) — "Download backup" via the shared `downloadFile`, "Restore from file" with the populated-tables warning list. NOTE: this endpoint exports the full PII workspace, so it must ride the same app-wide auth decision as the other recruiter surfaces (open follow-up ccb4d851) — flag it in the route comment like the others.
- **Why users need it**: The SQLite file IS the product state; one click before destructive automation is the difference between "undo" and data loss, and shareable workspace files make demos/onboarding reproducible.

## 4. Preflight and surface LLM engine availability (Gemini key, Claude CLI)
- **Value**: Medium
- **Category**: user_benefit
- **Effort**: S
- **Where**: `pipeline/jobfit/gemini.py:126` (`GEMINI_API_KEY`/`GOOGLE_API_KEY` read at call time), `pipeline/jobfit/claude_cli.py:106-108` (`available()` exists, never surfaced) (+ precedent: `voiceAvailability()` served by `app/api/interview/connect/route.ts:25` and consumed by `VoiceInterview.tsx:313`; `app/api/github-analysis/route.ts:473-477` is the one surface that degrades with a message)
- **Gap**: The two LLM engines have opposite, equally invisible failure modes. No Gemini key → an analyze task queues, spawns Python, and fails minutes later with an engine error. No `claude` on PATH → automation/reasoning/group-eval/JD-build silently produce deterministic fallback drafts that look like AI output. Voice providers got an availability map; the text engines that power the core product never did.
- **Proposal**: Add an `engines` block to `/api/health` (or `/api/ops` from #2): `gemini: Boolean(process.env.GEMINI_API_KEY ?? GOOGLE_API_KEY)` checked in Node, `claudeCli` via a once-per-process cached PATH probe (lookpath/`where claude`, mirroring `claude_cli._executable`'s PATHEXT note). Surface as status dots in the System card, plus a one-line pre-run hint on the Analyze form when Gemini is missing ("analysis will fail — set GEMINI_API_KEY") and a "deterministic fallback" badge near automation/reasoning triggers when the CLI is absent.
- **Why users need it**: Turns a class of late, cryptic task failures — and worse, silently non-AI "AI screening" — into an upfront, fixable one-liner.

## 5. Open a task's outcome: result summary, per-kind deep link, and a missed-failure signal
- **Value**: Medium
- **Category**: user_benefit
- **Effort**: M
- **Where**: `app/features/tasks/TasksTab.tsx:281-306` (DoneRow renders no result), `app/features/tasks/TasksProvider.tsx:39-43` (`fetchTask` built exactly for this, used by no list UI), `app/_lib/tasks.ts:59-77` (`batchScreen` returns a rich `{advanced, held, advisory, errors}` summary shown nowhere), `app/_lib/analyze-run.ts:162-188` (result carries `persistence.slug`)
- **Gap**: A succeeded "AI-screen all matched candidates" shows only a "Done" pill — its outcome breakdown is fetchable via `GET /api/tasks/[id]` but rendered nowhere; results are visible only on the surface that started the task, and navigation/refresh destroys that. There's also no path from a task row to the entity it concerns, and the sidebar indicator (`TasksIndicator.tsx:40-52`) signals running counts but never that something *failed* while you were on another tab.
- **Proposal**: Make Done rows expandable: on click, `fetchTask(id)` and render a compact per-kind summary (special-case `batch_screen`/`automation` counts; generic key/value fallback for the rest) plus a deep link derived from params/result — `entryId` → pipeline drawer (`?tab=pipeline`-style deep link the drawer already supports), analyze → `/history/<result.persistence.slug>`, `jd_build` → library. Add a small "N failed" badge to TasksIndicator counting failed/interrupted tasks newer than a locally-stored last-seen watermark, cleared when the tab is opened.
- **Why users need it**: Background tasks are where recruiters' long-running work lives; today its outcomes evaporate unless you kept the originating tab open, and failures finish silently.

## 6. Filter and search the background-task list
- **Value**: Low
- **Category**: user_benefit
- **Effort**: S
- **Where**: `app/features/tasks/TasksTab.tsx:59-63` (flat active/done split, no filtering), `app/api/tasks/history/route.ts:25-34` (offset/limit only) (+ precedent: the PIPE2/RES3 client-side filter bars, feature-scout 2026-06-08 W4)
- **Gap**: The live window mixes a dozen task kinds (automation, analyze, screening, JD builds, group evals, dev-case runs); finding "the failed automation runs for this candidate" means visual scanning, and the paged history can't be narrowed at all.
- **Proposal**: Reuse the established client-side filter-bar pattern over the loaded set: status chips (Failed/Interrupted/Done/Canceled), a kind select, and free-text over `label`. For the history table, thread optional `kind`/`status` query params into `/api/tasks/history` (two `WHERE` additions in `listTaskHistory`/`countTaskHistory`).
- **Why users need it**: Seven days of an active pipeline's tasks already exceeds quick scanning; filters make the tab usable as the audit surface it's becoming (especially alongside #1 and #5).

---
## Cross-checks performed
- Read `docs/harness/feature-scout-2026-06-08/INDEX.md` (backlog retired; none of the 60 opportunities touched the task runner, cache, health, or dump/load) and `harness-learnings.md`; listed today's sibling reports in `feature-scout-2026-06-10/` — `automation-orchestration.md` #2 proposes *scheduler* run history (scheduler_runs), distinct from the task-runner surfaces here; `demo-simulation-channels.md` owns comms-center/resend, so dead-letter handling is only *counted* in my #2, not actioned. No collisions; nothing dropped.
- Grepped `Retry|retry` in `app/features/tasks/` — the only "Retry" is the history-pagination error button (`TasksTab.tsx:208`); no failed-task re-run path exists. Confirmed `params_json` persists and `GET /api/tasks/[id]` returns full params/result (polled list projects them out).
- Grepped `api/health` repo-wide — matches only in docs/scan-plans; zero `fetch("/api/health")` callers in `app/`, so the probe is operator-invisible in-product.
- Grepped `db-dump|db-load|backup|dump` — `scripts/*.mjs`, `package.json` `db:dump`/`db:load`, README §96 only; no app/API caller, confirming portability is CLI-only.
- Grepped `cost_usd|\.usage` across `pipeline/` — parsed solely in `claude_cli.py` (+ its test); no caller persists or returns them. Confirmed `pipeline.py:282` logs Gemini usage to `tmp/pipeline.log` and grepped `pipeline\.log|analyze\.log|comms\.log` — writers and README mentions only, no reader anywhere.
- Grepped `GEMINI_API_KEY|voiceAvailability|availability` in `app/` — availability maps exist for voice providers and the github code-review degrades with a message; no preflight for the analyze/automation engines. `jd-build-run.ts:80`'s "availability" is the salary band, not the LLM (read to avoid over-claiming).
- Read in full: `tasks.ts`, `TasksProvider.tsx`, `TasksIndicator.tsx`, `TasksTab.tsx`, `api/tasks/*` (3 routes), `health/route.ts`, `cache.ts`, `db.ts` (schema + cache + seed/health sections), `python-runner.ts`, `logger.ts`, `logger.py`, `claude_cli.py`, `codegen.py`, `gemini.py` (usage/finish-reason section), `instrumentation.ts`, `next.config.ts`, `schemas.ts`, `dedupe.ts`, `scripts/_common.py`, `db-dump.mjs`, `db-load.mjs`, `analyze-run.ts` (result carries `persistence.slug` — the W1 CV1 deferral was about the live Analyze tab UI, not the task record).
- Checked `/api/sim/reset` (clears sim artifacts only) + boot seeding — left demo-data lifecycle out: `db-load` already covers "load a demo workspace" once #3 ships, and seeds self-load at boot.
