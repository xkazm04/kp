# Pipeline Board & Scheduler — UI+Bug combined scan
> Total: 4 findings (0 crit / 1 high / 2 med / 1 low)
> Group: Recruitment Pipeline & Scheduling | Lens mix: 3 bug / 1 ui | Files read: 19

Scope note: the context brief describes "live SSE updates," but the shipped
implementation has **no SSE and no interval poll for the board**. `/api/pipeline/events`
(`app/api/pipeline/events/route.ts`) is a cursor-paged JSON endpoint, and "live"
refresh is the same-document client event bus `useLiveRefresh` (`app/features/live-refresh.ts`).
Two of the findings below fall directly out of that gap, so I verified it across
the consumer (`PipelineTab`), the bus, and the server clock (`instrumentation.ts`)
rather than auditing a non-existent subscriber lifecycle. The previously-hardened
paths (CAS in `actOnPipelineEntry`/`setPipelineEntryStage`, single-flight pass,
`claimDueRun`/`advanceAfterForcedRun`, drawer focus trap + key remount, derived
board grid, lane-key alignment) were re-verified and are NOT re-flagged.

## 1. Open board silently goes stale when the automation clock advances/rejects entries in the background
- **Severity**: High
- **Lens**: bug
- **Category**: live-update / stale board state
- **File**: `app/features/sub_pipeline/PipelineTab.tsx:195-199` (consumer) + `instrumentation.ts:30-70` (server clock) + `app/features/live-refresh.ts:12-14` (bus)
- **Scenario**: A recruiter turns the Automation clock On (or `AUTOMATION_SCHEDULER_AUTOSTART=1`) and leaves the pipeline tab open. The 60s heartbeat in `instrumentation.ts` calls `tickScheduler()` → `runAutomationPass()`, which advances strong matches, auto-rejects BAU<40, and logs aging alerts — mutating `pipeline_entries`/`pipeline_events` server-side. The open board never changes: candidates stay in their old lanes, the "Awaiting you"/"Aging" StatChips stay wrong, and the Activity feed shows nothing new until the operator manually clicks something.
- **Root cause**: `PipelineTab` only re-fetches via `load()` on mount, on `useLiveRefresh`, on a finished `batch_screen`, after `runPass`, after a drawer change, and after a *manual* `SchedulerControl` "Run now". `useLiveRefresh` fires only on a `window` `kp:data-changed` event dispatched **inside the same browser document** (`notifyDataChanged()` is client-only). A server-process heartbeat tick has no client and dispatches nothing, so there is no signal — and no `setInterval` board poll exists to discover the change. The very feature that runs the pass on a cadence is the one whose results never reach the live board.
- **Impact**: The board misrepresents real state for as long as it stays open under automation — the central failure mode the "live view of candidates" header promises against. A recruiter can act on a candidate the scheduler already moved/rejected (the write CAS then 409s, but the *displayed* state was wrong the whole time).
- **Fix sketch**: Add a lightweight board poll in `PipelineTab` (e.g. `setInterval(load, 30_000)`, cleared on unmount, paused while a drawer/modal is open or the tab is `document.hidden`), reusing the existing abort+cursor machinery so it costs one `/api/pipeline` + one delta `/api/pipeline/events?since=` per tick. (Promoting `/api/pipeline/events` to a real SSE stream the heartbeat pushes to would also close it, but the poll is the minimal fix and matches the cursor design already in place.)

## 2. SchedulerControl's 30s poll observes background runs but never refreshes the board
- **Severity**: Medium
- **Lens**: bug
- **Category**: silent failure / missed propagation
- **File**: `app/features/sub_pipeline/SchedulerControl.tsx:91-107` (poll) vs `136-145` (`onRan` only on tick)
- **Scenario**: With the clock On, `SchedulerControl` polls `/api/automation/schedule` every 30s and updates its own `lastRunAt` + summary badges, so the bar *visibly proves* a background pass ran ("last auto-run 1m ago · 3 advanced"). The board beside it still shows the pre-pass lanes — the two surfaces openly disagree.
- **Root cause**: `load()` (the 30s poll) only calls `setSched(...)`; `onRan?.()` (which is `PipelineTab.load`) is invoked **exclusively** in the `update()` path guarded by `if (body.tick)` — i.e. only after a manual "Run now". The poll has the freshest evidence that entries changed (a newer `lastRunAt` than last seen) and is the natural propagation point, but it drops that signal on the floor.
- **Impact**: Even the one component already polling the server fails to reconcile the board, compounding finding #1 and making the staleness look like a bug the user can see ("the bar says it ran, why didn't the board move?"). Self-contained and independently fixable.
- **Fix sketch**: In `load()`, track the last-seen `lastRunAt` in a ref; when the polled value advances, call `onRan?.()` so the board reloads. (If finding #1's board poll lands, this becomes redundant — but as written it's a real missed wire.)

## 3. StageCell "+N more" expansion persists stale across filter/search/refresh
- **Severity**: Medium
- **Lens**: ui
- **Category**: missing state reset / stale local UI state
- **File**: `app/features/sub_pipeline/PipelineBoard.tsx:38-77` (`StageCell`, local `expanded`) + `:189-203` (`key={stage}`)
- **Scenario**: A recruiter expands an overflowing cell ("+4 more" → "Show fewer"), then types in the board search or a live/background reload swaps that lane's contents. The cell keeps `expanded = true`: it now renders whatever the new (often smaller) entry set is, fully expanded, and if the new set no longer overflows the toggle button silently disappears mid-interaction — leaving a cell that was "expanded" with no control to collapse and no indication the set changed underneath the user.
- **Root cause**: `StageCell` holds `expanded` in component-local `useState`, and the cell is keyed only by `stage` within a `pos.id` lane. That key is stable across `entries`/`filteredEntries` changes, so React preserves the old `expanded` state when the underlying lane is entirely different data. There is no reset (no `useEffect` on entry-set identity, no key incorporating the result count).
- **Impact**: Confusing board state on a common path (search-as-you-type, live refresh): expanded cells show a different population than the user expanded, and the collapse affordance can vanish. Degraded, not broken.
- **Fix sketch**: Reset on data change — either derive visibility without persistent state when overflow is gone, or add `useEffect(() => setExpanded(false), [entries.length])` (or fold a result-signature into the StageCell `key` so it remounts when the lane's contents change).

## 4. Horizontally-scrolling board region is not a focusable, labeled scroll container
- **Severity**: Low
- **Lens**: ui
- **Category**: accessibility (keyboard navigation)
- **File**: `app/features/sub_pipeline/PipelineBoard.tsx:146`
- **Scenario**: On a wide pipeline (5 stages × 280px + a 240px sticky column easily exceeds the viewport), a keyboard-only or screen-reader user cannot scroll the board horizontally by focusing it and using arrow keys — the `overflow-x-auto` div has no `tabIndex`, `role`, or accessible name. They must tab through every card to reach off-screen columns.
- **Root cause**: The scroll container at line 146 is a bare `<div ref={scrollRef} className="overflow-x-auto …">` with no `tabIndex={0}`/`role="region"`/`aria-label`. (The ◀/▶ header buttons and clickable stage headers exist and partly mitigate this, which is why it's Low rather than Medium — but the scroll region itself remains keyboard-inaccessible and unnamed.)
- **Impact**: Reduced keyboard/AT navigability of the primary board on wide pipelines. Polish-level; no regression to existing a11y (the buttons stay).
- **Fix sketch**: Add `tabIndex={0} role="region" aria-label="Pipeline board, scroll horizontally"` to the scroll container so it's focusable and arrow-key scrollable with an announced name; keep the ◀/▶ controls as the discoverable affordance.
