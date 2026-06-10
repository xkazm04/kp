# Fixes — Wave 10: Ops (2026-06-10)

> Theme J from INDEX.md, plus DATA6 (the task-list-filter Low whose surface this
> wave owns) and AUTO6 (automation-orchestration's reminders job).
> 7 findings: DATA1, DATA5, DATA6, DATA4, DATA2, DATA3, AUTO6. All implemented.
> Gates per fix: tsc 0, unit 657, lint clean on changed files (catalogs JSON-valid
> where touched). Wave verification: full `npm run build` + `test:python` 500 OK.

One mental model for the wave: **the system already records everything an
operator needs — give them the read, replay, and guard verbs.** Task params
were persisted but not replayable; results fetchable but not rendered;
telemetry written but never read; dump/restore built but terminal-only; the
reminder sweep ran but proved nothing.

---

## 1. DATA1 — One-click task retry (`2ae9c13`)

**Where**: `app/api/tasks/[id]/retry/route.ts` (new), `TasksProvider.tsx`, `TasksTab.tsx`

Every task row persists `params_json` — the exact replay payload — yet a
failed/interrupted row was a dead-end ("interrupted" is routine: every restart
marks in-flight rows). `POST /api/tasks/[id]/retry` loads the row server-side
(multi-MB params never round-trip), guards status (409) and `isKnownKind`
(400 for rows from older builds), then `startTask(kind, params)` — the dedupe
key merges double-clicks. Replayability verified per-kind: every handler's
params are self-contained or DB-keyed; nothing references per-run temp files.
Retry buttons on terminal dead-end rows (live + history); the old row stays as
the audit record.

## 2. DATA5 — Task outcome view + unseen-failure badge (`4acc4eb`)

**Where**: `TasksTab.tsx`, `TasksIndicator.tsx`

A succeeded batch screen showed only a "Done" pill while its rich summary sat
fetchable and unrendered; failures finished silently on other tabs. Done rows
now expand (fetchTask pulls the blobs the polled list omits) into a per-kind
summary — batch_screen counts, generic scalar fallback — plus a deep link
derived from params/result (analyze → `/history/<slug>`, jd_build → library,
entry kinds → the board via ANA1's `?q=`). TasksIndicator gains an
unseen-failures badge against a persisted `kp.tasksFailedSeenAt` watermark,
acknowledged by opening the tab.

## 3. DATA6 — Filter/search the task list (`5ff3318`)

**Where**: `TasksTab.tsx`, `app/api/tasks/history/route.ts`, `db.ts`

Client filter bar (the PIPE2/RES3 pattern): free text, kind select, terminal-
status chips. History narrows server-side (`?kind=`/`?status=` validated,
presence-chosen fixed clauses with bound params) — and because the
infinite-scroll engine accumulates per mount, the history panel is KEYED on
the filter combo so a change restarts pagination from offset 0.

## 4. DATA4 — Engine preflight (`1d3509e`)

**Where**: `app/_lib/engine-preflight.ts` (new), `/api/health`,
`useEngineAvailability.ts` (new), `AnalyzeForm.tsx`, `SchedulerControl.tsx`

Opposite, equally invisible failure modes: no Gemini key → analyze fails
minutes later; no `claude` on PATH → automation silently produces
deterministic fallbacks that LOOK like AI output. `engineAvailability()` (env
check + once-per-process PATHEXT-aware PATH scan) rides `/api/health` as an
informational block — deliberately NOT a degradedReason, since CLI-less
operation is a designed mode. Surfaced as a pre-run hint on the Analyze form
and a "Deterministic fallback" badge on SchedulerControl.

## 5. DATA2 — System/Ops panel (`c20cda1`)

**Where**: `app/_lib/ops-telemetry.ts` (new), `promptCacheStats` (db.ts),
`/api/ops` (new), `SystemCard.tsx` (new on the tasks tab)

Gemini token counts, per-stage timings, cache hit flags and comms dead-letters
were all written to `tmp/` JSONL that NOTHING read. Bounded tail readers (last
256KB, torn lines skipped, missing log → empty) feed `/api/ops`: health
verdict (always 200 — a dashboard read, not a readiness probe), engines,
prompt-cache rows + expired backlog, 7-day cache hit-rate / token spend /
stage timing averages / dead-letters, and the until-now process-local schedule
incident counters. SystemCard renders it where the operator already lives.

## 6. DATA3 — Workspace backup/restore from the UI (`3f4eb75`)

**Where**: `app/_lib/db-portability.ts` (new), `/api/workspace/export` +
`/api/workspace/import` (new), `BackupCard.tsx` (new)

The complete dump/restore (DDL+rows, BLOB-safe, all-or-nothing, refuse-to-
clobber) existed CLI-only. The script cores now live in TS (the .mjs scripts
keep bare-node copies; FORMAT/VERSION + cell encoding are the shared
contract). Export streams the dump (cache + runner state skipped); import is
two-step — dry-run plan first, explicit replace confirmation when live tables
hold rows — preserving the script's exact semantics. `coerceDumpPayload`
identifier-checks every table/column so a crafted dump can't escape its
quoting; both routes carry the ccb4d851 auth-follow-up flag (the dump IS the
PII workspace, and restore executes DDL by design).

## 7. AUTO6 — Reminders as a visible scheduler job (`ca17b92`)

**Where**: `scheduler-store.ts`, `instrumentation.ts`,
`/api/automation/schedule`, `SchedulerControl.tsx`

The candidate-facing reminder sweep ran every tick with no toggle, cadence,
run record, or UI trace. A `reminders` job row now exists (created ON at the
historical 1-minute cadence via `ensureReminderJob` — registration can never
silently stop sends); the heartbeat consults `claimDueRun(REMINDERS_JOB)` so
pausing actually pauses, `last_run_at` proves liveness, and sends/errors land
in `scheduler_runs` (zero-send sweeps record no row — noise at that cadence).
SchedulerControl shows the second job line: toggle, "checked Xm ago", latest
send count or error.

---

## Patterns worth keeping (→ harness-learnings)

1. **Persisted params ARE the retry feature** (DATA1): when a runner durably
   stores its request payload, replay is one server-side endpoint — verify
   per-kind that params are self-contained/DB-keyed before promising it.
2. **Telemetry must be read with bounded IO** (DATA2): tail-N bytes of JSONL,
   skip torn lines, missing file → empty. A dashboard read must never scale
   with the log's age.
3. **Extracting a CLI core for an API keeps the script's SEMANTICS, not just
   its code** (DATA3): refuse-to-clobber, all-or-nothing, dry-run-first are
   the contract; the UI adds explicit confirmation on top, never replaces it.
4. **Registering an always-on background job must preserve always-on** (AUTO6):
   per-job creation defaults (`ensureSchedule(name, defaults)`) + a canonical
   ensure-wrapper so whichever surface touches the row first creates it
   correctly — a default-OFF registration would have silently stopped
   candidate comms.
5. **An accumulating pagination hook restarts via keyed remount** (DATA6) —
   cheaper and less error-prone than adding reset plumbing to the hook.
