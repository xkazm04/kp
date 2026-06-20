# Tasks & System Operations — Tri-Lens Scan
> Total: 5
> Severity: 1 Critical / 2 High / 2 Medium / 0 Low
> Lens: 3 bug / 1 ui / 1 biz

## 1. Workspace backup dumps tables without a transaction — a torn snapshot is reported as a clean success
- **Lens**: 🐛 Bug Hunter (primary) / 🚀 Business Visionary
- **Severity**: Critical
- **Category**: Backup integrity
- **Value**: impact 9/10 · effort 3/10 · risk 2/10
- **File**: `app/_lib/db-portability.ts:57`
- **Scenario**: An operator clicks "Download backup" before a risky bulk action while a background task (or another tab) is mid-write. `dumpWorkspace` opens a read-only handle and loops `SELECT * FROM "<table>"` one table at a time (lines 66-81) with NO enclosing transaction / snapshot. A concurrent commit lands between, say, the `profiles` read and the `pipeline_entries` read, so the dump captures a child row whose parent is absent — a referentially torn backup. The export still returns 200 and the file downloads, so the operator banks a "good" snapshot that silently won't restore cleanly.
- **Root cause**: WAL mode gives a consistent read only inside an explicit transaction; the loop reads each table on its own implicit statement, so writes interleave across table boundaries.
- **Impact**: The single feature whose entire value is "trust this before you do something destructive" can produce a corrupt backup that *looks* successful — the worst failure mode for an operator-trust feature.
- **Fix sketch**: Wrap the whole table sweep in a `db.transaction(() => …)()` (or `BEGIN DEFERRED` / read snapshot) so all `SELECT`s observe one consistent point-in-time; better-sqlite3's `.transaction()` works on a readonly handle for reads. Optionally stamp a `rowCounts` manifest into the payload so a later restore can self-verify.

## 2. System card is a one-shot fetch — queue depth, health and token spend go stale the moment you watch a task run
- **Lens**: 🎨 UI Perfectionist (primary) / 🚀 Business Visionary
- **Severity**: High
- **Category**: Ops telemetry freshness / live UX
- **Value**: impact 7/10 · effort 2/10 · risk 1/10
- **File**: `app/features/tasks/SystemCard.tsx:41`
- **Scenario**: The System panel lives on the Background-tasks tab — exactly where an operator sits while tasks run. It reads `/api/ops` via `useJsonFetch` (`useJsonFetch.ts:20`), which fetches ONCE on mount and only re-fetches when `reload()` is pressed. Meanwhile the tasks list beside it polls every 2 s. So the "queue 2 running · 1 queued" line, `ok/Degraded` dot, and 7-day token spend freeze at the value they had when the tab opened: the user watches three tasks finish in the list while the System card still says "3 running", and a queue that drains (or stalls) is invisible until a manual Retry/Refresh.
- **Root cause**: `useJsonFetch` has no polling; `SystemCard` never calls `reload()` on an interval or on the same focus/visibility signal `TasksProvider` already uses.
- **Impact**: The operator's at-a-glance health/cost/queue panel actively contradicts the live list next to it, eroding trust in the very telemetry the panel exists to provide.
- **Fix sketch**: Poll `/api/ops` on an interval (e.g. reuse the 6 s idle / pause-when-hidden cadence from `TasksProvider`) — either add an `intervalMs` option to `useJsonFetch` or a `useEffect` in `SystemCard` calling `reload()`; also `reload()` on window focus. Keep the last good `data` visible during a refetch so it doesn't flash the "Loading…" state each tick.

## 3. Health probe reports "ok" even when running tasks are stale/orphaned — a wedged queue passes the readiness check
- **Lens**: 🐛 Bug Hunter (primary) / 🚀 Business Visionary
- **Severity**: High
- **Category**: Health false-positive
- **Value**: impact 7/10 · effort 4/10 · risk 3/10
- **File**: `app/api/health/route.ts:24`
- **Scenario**: `/api/health` builds `degradedReasons` from only two signals: seed errors and an empty job catalog (`tables.jobs === 0`). It reads `queue = countActiveTasks()` and reports the numbers, but never derives a degraded verdict from them — the header comment even says "reports orphaned tasks rather than mutating them," yet nothing inspects task *age* or staleness. Unlike `GET /api/tasks`, the health route does NOT call `ensureRecovered()`. So after a crash/restart that left rows stuck `running` (the runner only reconciles on the first `/api/tasks` read or at instrumentation boot), an uptime monitor hitting `/api/health` gets 200 "ok" while real work is permanently wedged.
- **Root cause**: Queue counts are reported but not evaluated; no notion of "a task has been `running` longer than any plausible run" feeds `degradedReasons`; recovery isn't triggered from the probe path.
- **Impact**: Deploy gates / uptime monitors that "gate on a real signal instead of just the process is up" (the route's stated purpose) get a green light over a stalled task system — exactly the outage the probe is meant to catch.
- **Fix sketch**: Add a `staleRunning` count (rows `running` with `started_at` older than, say, 2× `DEFAULT_TIMEOUT_MS`) via a small `db/tasks` helper; push a `degradedReason` when > 0. Optionally call `ensureRecovered()` here too so the probe is self-healing like the GET path.

## 4. spawnPython SIGKILL leaves orphaned descendant processes on Windows after a timeout/cancel
- **Lens**: 🐛 Bug Hunter (primary)
- **Severity**: Medium
- **Category**: Subprocess zombie / resource leak
- **Value**: impact 6/10 · effort 5/10 · risk 4/10
- **File**: `app/_lib/python-runner.ts:127`
- **Scenario**: On timeout, abort (task cancel), or output-cap breach, `fail()` calls `child.kill("SIGKILL")`. The Python CLIs spawn their own children — notably the `claude` CLI and `subprocess.run(...)` helpers. On Windows, `ChildProcess.kill()` terminates only the direct `python` process, not its descendant process tree, so a cancelled analyze/automation run can strand a live `claude`/grandchild that keeps holding a Claude-CLI subscription slot (`MAX_CONCURRENT = 2` is about respecting that ceiling). Repeated cancels accrete orphans until they exhaust the rate ceiling or memory.
- **Root cause**: No process-group / tree kill. POSIX could `detached:true` + `process.kill(-pid)`; Windows needs `taskkill /pid <pid> /T /F`. The current single-process `kill` is tree-unaware.
- **Impact**: Cancel/timeout — the safety nets — quietly leak the exact scarce resource (`claude` CLI slots) the concurrency cap is protecting; symptom is "new tasks queue forever" with no visible cause.
- **Fix sketch**: Spawn detached and kill the group: POSIX `process.kill(-child.pid, "SIGKILL")`; Windows `spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"])` in `fail()` (best-effort, swallow errors). Keep the existing `child.kill` as the fallback.

## 5. TasksIndicator renders two competing aria-live regions; the running count isn't announced once a failure badge is present
- **Lens**: 🎨 UI Perfectionist (primary)
- **Severity**: Medium
- **Category**: Accessibility (live region)
- **Value**: impact 4/10 · effort 2/10 · risk 1/10
- **File**: `app/features/tasks/TasksIndicator.tsx:86`
- **Scenario**: When both an unseen-failure badge and a running count are shown, the component emits TWO sibling `aria-live="polite"` regions (the failure pill at line 86-94 and the running-count pill at line 95-96) inside one button. Two simultaneously-updating live regions race; screen readers commonly announce only one or interleave them confusingly. Worse, the running-count pill is only rendered in the `running.length > 0` branch of a three-way ternary, and the static "total tasks" count (line 97-98) has no `aria-live` at all — so as tasks tick from running→done while a failure badge sits there, the count change can go unannounced. The comment claims the running count is announced "previously visual-only," but the failure region now competes with it.
- **Root cause**: Two independent `aria-live` regions on one control instead of one consolidated live status string; the count's live-ness is coupled to which ternary branch renders.
- **Impact**: The "always-at-a-glance" signal the indicator is built to provide degrades for screen-reader users in the common "things are running AND something failed" state.
- **Fix sketch**: Collapse to a single `aria-live="polite"` element whose text composes the whole status (e.g. `"3 running, 2 failed since you last looked"`), with the visual pills marked `aria-hidden`. One region, one coherent announcement, no race.
