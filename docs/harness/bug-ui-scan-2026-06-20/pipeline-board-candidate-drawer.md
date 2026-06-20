# Pipeline Board & Candidate Drawer — UI Perfectionist scan

> Context: The kanban-style hiring pipeline — drag candidates across stages, open a candidate drawer with full timeline and result, stream live updates.
> Files reviewed: 8 of 30
> Total: 7 findings — Critical: 0, High: 3, Medium: 3, Low: 1

## 1. Drag-and-drop stage move has no on-board keyboard or screen-reader path
- **Severity**: High
- **Category**: a11y
- **File**: `app/features/sub_pipeline/PipelineShared.tsx:215-230` (CandidateRow drag handlers), `app/features/sub_pipeline/PipelineBoard.tsx:77-94` (cell drop target), `app/features/sub_pipeline/CandidateDrawer.tsx:731-752` (the only keyboard alternative)
- **Scenario**: A keyboard-only or screen-reader recruiter wants to move a candidate from "Screened" to "Interview" directly on the board.
- **Root cause**: The cross-stage move is implemented purely with native HTML5 `draggable` + `onDragOver`/`onDrop` pointer events. The code comments explicitly defer the keyboard path to "the row's open/select button + the bulk-move bar" and the drawer `<select>`, but the board itself exposes no `aria-grabbed`, no roving-tabindex move affordance, and no announcement of drop targets. The drop cell highlight (`dropActive` ring) is a visual-only cue.
- **Impact**: The board's headline interaction (drag across stages) is unusable without a mouse/trackpad. Keyboard users must discover the drawer's stage `<select>` or enter select-mode bulk-move — neither is discoverable from the board. This is a WCAG 2.1.1 (Keyboard) gap on the feature's primary action.
- **Fix sketch**: Add a per-row "Move to…" menu button (e.g. the existing actions affordance) that opens a stage list reusing `moveEntry`, so every drag has a keyboard twin. Add `aria-roledescription="draggable"` to the row and an `aria-live` region in PipelineBoard that announces "Picked up X" / "Moved X to Interview" so the pointer DnD is also narrated.

## 2. Optimistic stage move gives no in-flight feedback and silently reverts on failure
- **Severity**: High
- **Category**: optimistic-feedback / silent-failure
- **File**: `app/features/sub_pipeline/PipelineTab.tsx:542-556` (`moveEntry`)
- **Scenario**: A recruiter drags a candidate to a new column while offline, or a concurrent actor already moved them (409), or the POST fails.
- **Root cause**: `moveEntry` optimistically restages, POSTs `set_stage`, and on `!r.ok` or a throw it just calls `restage(entry.id, prevStage)` then `load()`. There is no `role="alert"` / toast and no busy/saving state — the card simply snaps back to its old column. Contrast the drawer's manual move (`moveStage`, lines 311-325) which surfaces `moveErr`, and the bulk move which shows `bulkResult.failed`.
- **Impact**: A failed move (including the common optimistic-concurrency 409 the CAS guard is designed to produce) looks like the candidate "bounced back" for no reason. The recruiter has no idea whether it failed, why, or that someone else moved them — they may retry into the same race repeatedly.
- **Fix sketch**: Track a moving/error state per entry; render a transient `role="status"` toast ("Couldn't move X — someone changed their stage") on rollback, and dim/spinner the card while the POST is in flight. Reuse the drawer's `moveFailed` copy so the grammar is consistent.

## 3. The board scroll region and StageCell columns are inaccessible to screen readers (no list/grid semantics, no per-column labels)
- **Severity**: High
- **Category**: a11y
- **File**: `app/features/sub_pipeline/PipelineBoard.tsx:224-313`
- **Scenario**: A screen-reader user navigates the board to understand which candidates sit in which stage for which position.
- **Root cause**: The board is a stack of `<div className="grid">` rows with stage headers as `<button>`s, but there is no programmatic association between a `StageCell`'s candidates and its stage column — the cells are bare `<div>`s with no `role`, `aria-label`, or heading. The header buttons exist only to re-center/scroll, not to label. The empty-cell placeholder is a decorative `·` (`<span className="text-stone-300">·</span>`, line 128) with no accessible "empty" text. The `aria-label={t("board.boardAria")}` region gives one flat label for the entire 2D structure.
- **Impact**: A screen-reader user hears candidate names with no stage/position context — they cannot tell that "Erika N." is in the Offer column of the Backend Engineer lane. The 2D pipeline collapses into an unlabeled list, defeating the board's core information design.
- **Fix sketch**: Give each row `role="row"` with the position as `aria-label`, each `StageCell` `role="gridcell"` + `aria-label={stage}` (or wrap candidates in a labelled list `aria-label={t('stageHasN', {stage, count})}`), and replace the `·` placeholder with visually-hidden "No candidates" text. Consider `role="grid"` on the board container.

## 4. Candidate status dot uses `role="img"` on an interactive-looking control and conveys aging only via a `title` tooltip
- **Severity**: Medium
- **Category**: a11y
- **File**: `app/features/sub_pipeline/PipelineShared.tsx:232-239`
- **Scenario**: A touch or keyboard user needs to know why a card is flagged (degraded vs awaiting-decision vs aging) without a hover-capable pointer.
- **Root cause**: The state dot is a `<span role="img" aria-label={dotTitle} title={dotTitle}>`. The `aria-label` covers screen readers, but the rich `dotTitle` (e.g. "Aging — 7 days in Screened") is only revealed to sighted users on `title` hover, which never fires on touch and isn't keyboard-focusable. The dot is also not in the tab order, so the state is effectively pointer-hover-only for sighted-but-mouseless users.
- **Impact**: Aging/awaiting/degraded status — the board's triage signal — is discoverable on hover only. Touch users and keyboard users get the colour/glyph but not the explanatory text. (The Legend mitigates this partially but requires cross-referencing.)
- **Fix sketch**: Surface the state as a small visible text label or a focusable chip beside the name on smaller/touch breakpoints, or fold the state into the name button's `aria-label`/visible caption rather than a hover-only `title`. The glyph differentiation is already good; the missing piece is non-hover text.

## 5. Drawer fires five independent best-effort fetches on open with no loading skeleton — sections pop in incrementally
- **Severity**: Medium
- **Category**: missing-loading-state / CLS
- **File**: `app/features/sub_pipeline/CandidateDrawer.tsx:164-245` (5 effects: interview, prep, comms, events, timeline)
- **Scenario**: A recruiter opens the candidate drawer; each of interview outcome, human scorecard, GitHub evidence, comms, and history loads on its own timeline.
- **Root cause**: Each section is gated on its own state being non-null/non-empty (`ivOutcome ?`, `humanSc ?`, `comms && comms.length ?`, `mergedHistory.length ?`). There is no aggregate loading indicator and no skeleton placeholder; sections appear one by one as fetches resolve, shifting everything below them (the AI-actions grid, notes, consent panel) down the scroll. On a failed/empty fetch the section is simply absent, indistinguishable from "loading".
- **Impact**: Visible layout shift (CLS) as each card pops in; the recruiter can't tell whether "no interview outcome" means none exists or it's still loading. The first-focused element (focus trap, line 137) may also move under the user mid-load.
- **Fix sketch**: Render skeleton placeholders for the history/comms/evidence regions while their fetches are pending (track a `loading` flag per fetch), and reserve their vertical space so later sections don't jump. Distinguish "loaded, empty" (hide) from "still loading" (skeleton).

## 6. Bulk action loop awaits N sequential POSTs with no per-item progress
- **Severity**: Medium
- **Category**: missing-progress-state
- **File**: `app/features/sub_pipeline/PipelineTab.tsx:445-470` (`bulkMove`), `477-502` (`bulkDecide`)
- **Scenario**: A recruiter selects 30 aging candidates and clicks "Move 30" or bulk-reject.
- **Root cause**: `bulkMove`/`bulkDecide` `await` each `postPipelineAction` in a serial `for` loop. The only feedback is the button's `bulkBusy` → "Moving…" label; there is no "12 of 30" counter and the board doesn't `load()` until the entire loop finishes. For dozens of candidates this is many seconds of an opaque spinner with the whole selection frozen.
- **Impact**: On large cohorts (the exact case bulk mode exists for) the UI looks hung; the recruiter can't tell progress, can't cancel, and a mid-loop tab-close drops the remaining moves silently. The result summary only appears at the very end.
- **Fix sketch**: Surface a live "n of total" counter via an `aria-live` region updated each iteration, and disable only the action buttons (not the whole bar) so the operation is observably progressing. Consider chunked `Promise.allSettled` with bounded concurrency to shorten wall-clock time.

## 7. `StageCell` "+N more" expansion silently collapses on every live refresh because the cell key includes entry ids
- **Severity**: Low
- **Category**: interaction-correctness
- **File**: `app/features/sub_pipeline/PipelineBoard.tsx:285-308` (key = `` `${stage}:${cellEntries.map(e=>e.id).join(",")}` ``), `app/features/sub_pipeline/PipelineTab.tsx:272-278` (30s poll)
- **Scenario**: A recruiter expands a column's "+4 more" to read all candidates; 30 seconds later the background poll returns (or any other actor changes state).
- **Root cause**: The cell key deliberately folds the entry-id list in so the cell remounts when its population changes (a documented fix for stale expansions). But the 30s board poll re-fetches `/api/pipeline` even when nothing changed for that lane; if the entries array identity/order shifts at all the key changes and the expanded cell remounts collapsed. The remount also resets scroll within the cell.
- **Impact**: A recruiter reading an expanded lane can have it silently re-collapse under them every 30 seconds even when that specific lane didn't change, forcing a re-expand. Minor but recurring friction on busy lanes.
- **Fix sketch**: Key the cell on stage + a stable lane identity (e.g. position id + a content hash that ignores order), or lift the `expanded` state up keyed by stage so it survives a same-population remount. Only remount when the cell's membership set actually differs.
