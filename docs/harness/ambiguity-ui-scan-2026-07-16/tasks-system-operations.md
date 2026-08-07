# Tasks & System Operations — ambiguity-guardian + ui-perfectionist scan

> Total: 5 findings (0 critical, 1 high, 3 medium, 1 low)

## 1. `opts.env` override of `KP_LLM_USAGE_LOG` silently loses metering and leaks the sidecar
- **Severity**: High
- **Lens**: ambiguity
- **Category**: contradictory-contract
- **File**: `app/_lib/python-runner.ts:129`
- **Scenario**: A future caller passes `opts.env = { KP_LLM_USAGE_LOG: "/my/path.ndjson" }` because the code comment (line 129) explicitly says "opts.env can override it if a caller needs to." The child then writes its LLM-usage NDJSON to the caller's path, but `ingestUsageLog` runs against `usageLogPath` — the *generated* path (line 133), computed before the override — which the child never wrote. The spend never lands in `llm_usage` and the caller's real sidecar is never deleted.
- **Root cause**: `usageLogPath` is captured for both the child env and the ingest step, but `opts.env` is spread *after* `KP_LLM_USAGE_LOG: usageLogPath` in the child env (line 141-147), so the two can diverge while the ingest side still reads the pre-override value.
- **Impact**: A documented, supported escape hatch produces silent metering loss plus a tmp-file leak — exactly the kind of trap the comment invites a maintainer to walk into. Today no caller overrides it, so it is latent, but the contract is a live contradiction.
- **Fix sketch**: Resolve the effective sidecar path once from the merged env — e.g. compute `const effective = opts.env?.KP_LLM_USAGE_LOG ?? usageLogPath;` and use `effective` for the `ingest`/opt-out decision — or drop the "can override" claim and hard-own the key. Either make the comment true or make the code enforce it.

## 2. `RECENT_WINDOW_DAYS` is a hand-copied duplicate of the server constant that will silently drift
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: duplicated-source-of-truth
- **File**: `app/features/tasks/TasksTab.tsx:21`
- **Scenario**: An operator changes `RECENT_TASK_WINDOW_DAYS` in `app/_lib/tasks.ts` from 7 to 14. The API now returns 14 days of live tasks, but the tab still renders "Done · last 7 days", "last 7 days", "tasks older than 7 days", and the empty-state copy — all reading the stale client copy. Data and labels disagree, and "Show history (older than 7 days)" now overlaps the live window.
- **Root cause**: The value is restated as a client-side literal (with a comment acknowledging the duplication) because the server module can't be imported into the client bundle — but nothing keeps the two numbers in sync.
- **Impact**: A one-line server change quietly produces a UI that lies about its own time window, including a history filter boundary that no longer matches the server cutoff.
- **Fix sketch**: Extract the constant into a tiny client-safe module (no `better-sqlite3` imports) that both `tasks.ts` and `TasksTab.tsx` import, so the window is defined once. If that is impractical, have the `/api/tasks` response echo the window length and render labels from it.

## 3. Warning "amber" is a raw Tailwind color with no design token and is applied inconsistently
- **Severity**: Medium
- **Lens**: ui
- **Category**: color-token-inconsistency
- **File**: `app/features/tasks/TasksTab.tsx:37`
- **Scenario**: The surface's status/severity language is built on semantic tokens (`coral`, `moss`, `steel`, `ink`, `paper`, `stone`), but the "warning/interrupted" state has no token, so it is hand-rolled with stock Tailwind amber — and inconsistently: the interrupted badge is `bg-amber-100 text-amber-700` with an `text-amber-600` icon, while `SystemCard` (`SystemCard.tsx:94`) and `BackupCard` (`BackupCard.tsx:158`) warnings use `bg-amber-50 ... text-amber-700`. Same semantic meaning, three different amber recipes.
- **Root cause**: No `warning`/`amber` entry exists in the token palette, so each warning surface improvises its own shades (amber-50 vs amber-100 fills, amber-600 vs amber-700 text).
- **Impact**: Warning affordances read as slightly different colors across the very same tab, and they sit outside the theming system, so any future palette adjustment misses them. It is a visible inconsistency and a maintenance trap.
- **Fix sketch**: Add a `warning`/`amber` semantic token (fill + border + text + icon) to the design palette alongside coral/moss, then replace the raw `amber-*` classes in these three files with it so every warning renders one calibrated color.

## 4. Unseen-failures badge flashes the full historical failure count on every load
- **Severity**: Medium
- **Lens**: ui
- **Category**: hydration-flash
- **File**: `app/features/tasks/TasksIndicator.tsx:46`
- **Scenario**: On any page load with the tasks tab not active, `seenAt` starts as `""` and is only hydrated from `localStorage` in a mount effect. During the first render(s) before that effect commits, `unseenFailed` counts every terminal task because any ISO timestamp compares `> ""`. The sidebar footer momentarily shows a badge with the count of *all* historical failed/interrupted tasks, then snaps down to the true unseen count once `localStorage` is read.
- **Root cause**: The watermark's initial value (`""`) is a valid lower bound for the lexical ISO comparison, so the "unseen since last visit" filter is fully permissive until hydration replaces it.
- **Impact**: A jarring, wrong high-count alert flashes on essentially every navigation/refresh, undermining trust in an indicator whose whole purpose is an at-a-glance failure signal.
- **Fix sketch**: Gate `unseenFailed` behind a "hydrated" flag (compute it as `0`/hidden until the mount effect has read `localStorage`), or seed `seenAt` from `localStorage` synchronously via a lazy `useState` initializer guarded for SSR, so the first client render already has the real watermark.

## 5. Destructive-restore confirmation accepts any casing, and one `busy` flag conflates export with import
- **Severity**: Low
- **Lens**: ui
- **Category**: confirmation-friction
- **File**: `app/features/tasks/BackupCard.tsx:192`
- **Scenario**: The card instructs the user to type `REPLACE` to confirm a whole-database overwrite, but the guard is `confirmText.trim().toUpperCase() !== CONFIRM_WORD`, so `replace`, `Replace`, or `  rEpLaCe ` all pass — softening the deliberate friction of a typed confirmation. Separately, export and import share a single `busy` boolean: starting a long export disables "Restore from file…" and shows a generic "Working…", giving no signal about which operation is running; and the success line tells the user to "Reload the page" but never reloads.
- **Root cause**: The confirm comparison normalizes case (defeating the "type it exactly" intent), and a single `busy` state stands in for two independent async operations.
- **Impact**: The safety gate is weaker than it presents, and the two-operation UI is ambiguous during in-flight work — papercuts on an otherwise careful destructive flow.
- **Fix sketch**: Compare against the exact word (`confirmText.trim() !== CONFIRM_WORD`) to honor the instruction, and split `busy` into `exporting`/`importing` (or a small union) so each button reflects its own state and the label names the running operation.

---

Files read: 24 in-scope files (all task/system UI, the tasks/ops/health API routes, `tasks.ts`, `task-dedupe.ts`, `ops-telemetry.ts`, `python-runner.ts`, `scheduler-health.ts`, the dev-inspector trio + build scripts, `sales-contact.ts`, `site-url.ts`, `instrumentation-node.ts`, `playwright.config.ts`) plus a peek at `task-dedupe.test.ts` as evidence.
