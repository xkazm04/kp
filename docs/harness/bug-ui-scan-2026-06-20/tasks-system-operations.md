# Tasks & System Operations — UI Perfectionist scan

> Context: The background task tracker (provider, indicator, tasks tab), system/backup cards, health and ops telemetry, and the Python runner bridge.
> Files reviewed: 12 of 22
> Total: 7 findings — Critical: 0, High: 3, Medium: 3, Low: 1

## 1. Destructive workspace restore "Replace tables" fires on a single click — no confirmation gate

- **Severity**: High
- **Category**: unguarded-destructive-action
- **File**: `app/features/tasks/BackupCard.tsx:170` (and `applyRestore` at :74)
- **Scenario**: An operator picks a backup file, sees the dry-run plan listing live tables that "will be REPLACED", and clicks the single red **"Replace N tables & restore"** button. That one click immediately POSTs `apply:true, replace:true` and overwrites the *entire* kp database across every workspace (the card's own copy says "all data across every workspace").
- **Root cause**: The two-step flow (pick → preview plan) is treated as sufficient consent, but the final irreversible action is a one-click button with no typed confirmation, no "type RESTORE to confirm", and no `window.confirm`. The amber warning is passive text next to the trigger.
- **Impact**: A misclick (or a stale plan left on screen) wipes the whole multi-workspace database with no undo. This is the single highest-blast-radius control in the context.
- **Fix sketch**: Gate the replace path behind an explicit confirm — a typed-token input ("type the number of tables" or "REPLACE") that enables the button, or a second confirm dialog naming the populated tables. Keep the non-destructive ("Restore" into empty tables) path one-click.

## 2. Canceling a running task has no confirmation and no optimistic/pending feedback

- **Severity**: High
- **Category**: unguarded-destructive-action / missing-loading-state
- **File**: `app/features/tasks/TasksTab.tsx:357` (`ActiveCard` cancel button), provider `cancelTask` at `app/features/tasks/TasksProvider.tsx:104`
- **Scenario**: A user clicks the small `X` on an in-progress task (e.g. a multi-minute `analyze` or `batch_screen`). `cancelTask` fires DELETE with zero confirmation; the card stays visually identical until the next 2 s poll tick, so the click feels dead and is easy to repeat.
- **Root cause**: `cancelTask` is fire-and-forget (`catch { /* ignore */ }` swallows failures) and the button has no disabled/pending state. There's no confirmation despite discarding an expensive long-running run.
- **Impact**: Accidental cancellation of costly LLM tasks; on a failed DELETE the user gets no feedback at all (unlike `startError`/`retryTask`, which surface errors). Up to a 2 s window where the UI looks unresponsive.
- **Fix sketch**: Add a lightweight confirm for active cancels, set a local `canceling` state to disable the button + show a spinner immediately, and surface a DELETE failure through the same `startError` channel instead of swallowing it.

## 3. TasksTab is a heading-less, landmark-less `<section>` — and `SystemCard` "Loading…" / poll updates aren't announced

- **Severity**: High
- **Category**: a11y
- **File**: `app/features/tasks/TasksTab.tsx:87` (root `<section>` with no `aria-label`), `app/features/tasks/SystemCard.tsx:62` (bare `<p>Loading…</p>`)
- **Scenario**: A screen-reader user lands on the Background tasks view. The page's `<h2>` lives inside an unlabeled `<section>`, so it is not exposed as a named region/landmark. The live task list and SystemCard refresh silently every 2–6 s with no `aria-live`/`aria-busy`, so a task moving from "Running" to "Done", or System loading→data, is never announced. The `TaskHistory` block correctly uses `aria-busy`, making the live region's omission inconsistent.
- **Root cause**: The provider was carefully wired for live polling, but the live regions weren't marked up for assistive tech; only the sidebar indicator got `aria-live`.
- **Impact**: SR users can't perceive task progress/completion on the page itself, and the operator panels read as anonymous content. Inconsistent with the project's own `aria-busy` usage in `TaskHistory` and `aria-live` in `TasksIndicator`.
- **Fix sketch**: Give the root `<section>` an `aria-label="Background tasks"` (or `role="region"`), add `aria-busy` to the "In progress" group while it has active tasks, wrap the SystemCard's loading→loaded swap with `aria-live="polite"`, and add `role="status"` to the bare "Loading…" text.

## 4. SystemCard error/loading and BackupCard preview lack the `role`/`aria-busy` treatment used elsewhere in the same file group

- **Severity**: Medium
- **Category**: a11y / consistency
- **File**: `app/features/tasks/SystemCard.tsx:50` (error block, no `role="alert"`), `:62` (loading, no `role="status"`)
- **Scenario**: The SystemCard fetch fails; the coral error box renders without `role="alert"`, so an SR user gets no announcement — whereas BackupCard (`app/features/tasks/BackupCard.tsx:136`) and IntegrationsCard both correctly use `role="alert"`/`role="status"` for the identical pattern.
- **Root cause**: Copy-paste drift between three sibling operator cards in the same tab; the error/status `role` convention was applied to two of three.
- **Impact**: Inconsistent assistive-tech behavior across visually-identical cards on one screen; the failing one is the silent one.
- **Fix sketch**: Add `role="alert"` to the SystemCard error container and `role="status"` to its loading text, matching the sibling cards. Consider extracting a shared `<CardError onRetry>` / `<CardLoading>` primitive used by all three.

## 5. IntegrationsCard shares one `busy` flag across Save + Send-test, and success notes never clear

- **Severity**: Medium
- **Category**: interaction-correctness / stale-state
- **File**: `app/features/tasks/IntegrationsCard.tsx:29` (`busy`), `save` :49, `sendTest` :77
- **Scenario**: The operator clicks **Save**; while it's in flight the **Send test ping** button is also disabled (shared `busy`) with no spinner on either, so it's unclear which action is running. After Save, the green "Saved." note (`note`) and the test result line (`test`) persist indefinitely — a later unrelated edit still shows the stale "Saved." until the next save.
- **Root cause**: A single `busy` boolean drives two independent async actions, and success messages have no timeout or change-driven reset.
- **Impact**: Ambiguous in-flight state (which button is working?), and stale success/confirmation text that misrepresents the current form state after the user has edited fields.
- **Fix sketch**: Use per-action pending state (`saving`/`testing`) with an inline spinner on the active button only; clear `note`/`test` when the form fields change (or auto-dismiss after a few seconds), and disable Save when the form is unchanged.

## 6. Active-task progress bar is misleading: indeterminate runs render a fake fixed-width "8%" bar

- **Severity**: Medium
- **Category**: misleading-affordance
- **File**: `app/features/tasks/TasksTab.tsx:38` (`pct`), bar at `:366`
- **Scenario**: A running task that reports no `progressTotal` (the common case for LLM kinds like `analyze`) gets `pct()` = 8, and the bar renders at a static `Math.max(6, 8)%` width that never moves for the whole run. A `queued` task shows a 0→6% sliver. Users read a stalled-looking determinate bar instead of "indeterminate / working".
- **Root cause**: A determinate progress bar is reused for genuinely indeterminate work by faking a small percentage, rather than rendering an indeterminate (animated/striped) bar.
- **Impact**: The progress affordance lies — a long indeterminate task looks frozen at ~8%, undermining trust in the live view and prompting needless cancels (see Finding 2).
- **Fix sketch**: When `progressTotal <= 0`, render an indeterminate bar (an animated shimmer/marquee fill) gated on `useReducedMotion`, and only show the determinate `%` fill when real `progressTotal > 0`.

## 7. Filter chips can leave a "No tasks match these filters" empty state on a status the live window can't show

- **Severity**: Low
- **Category**: empty-state / interaction-correctness
- **File**: `app/features/tasks/TasksTab.tsx:182` (empty state), status filter `:153`, `done` filter `:79`
- **Scenario**: With only running tasks present, the user picks a terminal-status chip (e.g. "Succeeded"). `done` becomes empty and `active` is hidden by the status filter's group, so the whole list collapses to the generic "No tasks match these filters" — even though active tasks exist; the status chips only ever narrow the Done group, which isn't obvious from the UI.
- **Root cause**: Status chips conceptually apply only to terminal/Done tasks, but selecting one visually empties the page without explaining that the In-progress group is intentionally exempt from status filtering.
- **Impact**: Mild confusion — the board looks empty while work is actually running; the relationship between the chips and the two groups is undiscoverable.
- **Fix sketch**: Keep the "In progress" group visible (or show a one-line hint) when a terminal-status chip is active, or disable/grey terminal-status chips while there are zero matching Done tasks, clarifying that chips filter finished runs only.
