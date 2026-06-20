# Interview Scheduling, Prep & Rubric — UI Perfectionist scan

> Context: Send self-scheduling invites, pick slots across timezones, generate interview prep packs and rubrics, and track invite lifecycle and reminders.
> Files reviewed: 14 of 31
> Total: 7 findings — Critical: 0, High: 2, Medium: 3, Low: 2

## 1. Recruiter calendar offers 50 slots the candidate can never be booked into

- **Severity**: High
- **Category**: misleading-affordance / dual-system-drift
- **File**: `app/features/sub_schedule/ScheduleTypes.ts:21` (and `app/features/sub_schedule/ScheduleCalendar.tsx:75-92`, `app/_lib/schedule-slots.ts:18`)
- **Scenario**: A recruiter opens the Schedule tab, clicks an empty `Wed 16:00` cell on the week grid to "propose" that slot for a candidate, then hits Confirm.
- **Root cause**: The recruiter calendar renders `TIMES = ["08:00" … "17:00"]` (10 hourly rows × 5 days = 50 cells), but the candidate-facing self-scheduling engine only ever offers two times — `app/_lib/schedule-slots.ts:18` `const TIMES = ["10:00", "14:00"]` — and `offeredSlotFor()` rejects anything else. The grid's "proposed slot" (a legacy `approvalDetail` string like `"Wed 16:00"`) is a completely different mechanism from the ISO slot the candidate actually books, and nothing on the grid reflects which times the candidate can really pick.
- **Impact**: The recruiter spends effort proposing times (`08:00`, `11:00`, `15:00`, `17:00`) that are structurally un-bookable by the candidate; the proposed chip and the candidate's eventual booking silently disagree. The two "slot" concepts share the word "slot" and the same tab but never reconcile, which is the kind of mismatch that erodes trust in the whole scheduling surface.
- **Fix sketch**: Drive the grid's `TIMES`/`DAYS` from the same source as `proposeSlots` (or visually mark the two offerable rows and dim the rest), and show the candidate's actual booked ISO time on the card once it lands, rather than only the recruiter's proposal chip.

## 2. Week-grid calendar is built from `<div>`s, not a table — no row/column semantics for SR/keyboard users

- **Severity**: High
- **Category**: a11y
- **File**: `app/features/sub_schedule/ScheduleCalendar.tsx:66-135`
- **Scenario**: A screen-reader or keyboard-only recruiter tries to understand "which candidate is in which day/time" or tab through the grid.
- **Root cause**: The calendar is a CSS-grid of plain `<div>`s with a day header row of `<div>`s and a leading time-label `<div>` per row. There is no `<table>`/`role="grid"`, no `scope`/header association, and each cell holds a full-cell "assign" `<button>` whose `aria-label` ("Assign Wed 16:00") plus the chip buttons. A reduced-motion or AT user gets a flat stream of ~55 buttons with no spatial/columnar relationship; the time-axis labels (`08:00`…) are never programmatically tied to the cells.
- **Impact**: The core scheduling visualization is effectively unusable non-visually — you cannot tell that a chip sits at "Wed 16:00" except by reading each cell's assign-button label, and the time-label column conveys nothing to AT. The horizontally-scrolling region (line 60-64) is also not keyboard-scrollable on its own.
- **Fix sketch**: Wrap the grid in `role="grid"` with `role="row"`/`role="columnheader"`/`role="rowheader"` (or a real `<table>`), associate the `08:00` labels as row headers, and give the scroller `tabIndex={0}` + an `aria-label` so it's reachable and scrollable by keyboard.

## 3. Inconsistent initial-load treatment: plain text line on the tab vs. skeleton in the panel

- **Severity**: Medium
- **Category**: loading-state / visual-consistency
- **File**: `app/features/sub_schedule/ScheduleTab.tsx:223-224` (vs. `app/features/sub_schedule/InviteLifecyclePanel.tsx:58-60`)
- **Scenario**: The recruiter opens the Schedule tab on a cold load; `/api/pipeline` is in flight.
- **Root cause**: The tab body renders a bare `<p>{t("loading")}</p>` while `entries == null`, but the `InviteLifecyclePanel` that sits directly above it renders a proper animated skeleton (`role="status"` `h-16 animate-pulse`). Two sibling regions of the same screen use two different loading idioms, and the larger region (the whole calendar + lists) gets the cheaper one.
- **Impact**: A jarring, inconsistent first paint — a polished pulse block above a single grey sentence — and a larger layout shift when the calendar grid replaces the one-line text. The design system clearly has a skeleton pattern; the primary region doesn't use it.
- **Fix sketch**: Replace the loading sentence with a skeleton matching the eventual two-column layout (a grid placeholder + an aside of card placeholders), reusing the same `animate-pulse` treatment as `InviteLifecyclePanel`.

## 4. Calendar list never refreshes itself; only the prep/interview side-channels poll

- **Severity**: Medium
- **Category**: stale-state
- **File**: `app/features/sub_schedule/ScheduleTab.tsx:98-100` (and 116-143)
- **Scenario**: A candidate self-cancels their RSVP (freeing the slot and re-opening the invite) or another recruiter declines a candidate while this Schedule tab is open.
- **Root cause**: `load()` (the `/api/pipeline` fetch that builds `entries`, `picks`, and the calendar) runs exactly once in a mount-only `useEffect`. There are interval+focus refreshers for `interviews` and `prepared`, and `InviteLifecyclePanel` fetches once, but the *calendar list itself* and the lifecycle panel never re-poll. So a card stays in "Pending interviews" with a stale proposed slot after the underlying entry changed elsewhere.
- **Impact**: The recruiter acts on a stale board — confirming a candidate who was already declined, or not seeing a freed slot — and only a full tab remount fixes it. The `window.focus` refresh that exists for interviews/prep notably does *not* extend to the entry list.
- **Fix sketch**: Add the same focus/interval refresh (or a `pipeline/events` SSE subscription) to `load()` and to `InviteLifecyclePanel`, so the board and the lifecycle agenda stay as fresh as the prep/interview pills already do.

## 5. Human scorecard panel stays open and gives no closure after a gating save

- **Severity**: Medium
- **Category**: optimistic-feedback / missing-state-resolution
- **File**: `app/features/sub_schedule/HumanScorecardPanel.tsx:89,199-203` (and `app/features/sub_schedule/InterviewPrepModal.tsx:432-439`)
- **Scenario**: A recruiter fills the rubric, picks a verdict, and clicks Save; the save returns `gated:true` (the candidate just moved to the Decisions queue).
- **Root cause**: On a gating save the panel shows a static "moved to Decisions" `role="status"` line but the expanded scorecard, the Save button, and all the rating controls remain fully interactive in place. The parent only reloads the board when the *modal* is closed (`InterviewPrepModal onClose → load()`), so nothing in the open modal reflects that the entry has changed gate. The recruiter can keep editing/re-saving a scorecard for an entry that has already advanced.
- **Impact**: Ambiguous post-action state — the most consequential action in this surface (advancing the candidate) leaves the UI looking exactly as it did before, inviting duplicate saves and confusion about whether the move "took".
- **Fix sketch**: After a `gated` save, collapse the rubric to a confirmed summary (verdict + "Review in Decisions →" link), disable further edits, and consider auto-closing or surfacing a clear next-step CTA rather than leaving the full form live.

## 6. Coverage progress is announced twice and can read redundantly

- **Severity**: Low
- **Category**: a11y / redundancy
- **File**: `app/features/sub_schedule/InterviewPrepModal.tsx:292,313-317`
- **Scenario**: A screen-reader user navigates the prep modal header while ticking checklist items.
- **Root cause**: The same progress is conveyed by both the `{doneCount}` text badge ("3 / 9") and the `Meter` with `aria-label={t("coverageAria", { done, total })}` ("covered 3 of 9") sitting immediately adjacent. The `Meter` is a `role="progressbar"` with its own `aria-valuenow`, so AT users hear the count, then the labelled progressbar value, then the same numbers again — three near-identical announcements for one fact.
- **Impact**: Verbose, slightly confusing AT output; visually the doubled numeric presentation adds clutter to the header.
- **Fix sketch**: Mark the textual badge `aria-hidden` (let the progressbar carry the value) or drop the count from the meter's `aria-label`, keeping one authoritative announcement.

## 7. Calendar empty cells are an unlabeled grid of identical hover targets

- **Severity**: Low
- **Category**: polish / affordance
- **File**: `app/features/sub_schedule/ScheduleCalendar.tsx:86-92`
- **Scenario**: A recruiter scans the grid with no candidate selected and hovers cells.
- **Root cause**: Every empty cell is a full-bleed `<button>` with only a `hover:bg-coral/5` tint and an `aria-label`, but clicking a cell with no candidate selected (`selectedId === null`) silently does nothing — `onPickSlot` → `pickSlot` early-returns at `ScheduleTab.tsx:171` when `!selectedId`. So 50 cells advertise themselves as clickable (cursor, hover wash, button role) yet are dead until a candidate is selected, with no inline hint of the "select a candidate first" precondition (only the aside footer text says it).
- **Impact**: Confusing dead-control affordance — the grid invites a click that does nothing, and the prerequisite is explained far away in the side panel.
- **Fix sketch**: When `selectedId` is null, set the cell buttons `disabled`/`aria-disabled` (drop the hover wash and pointer cursor), or surface an in-grid prompt; re-enable on selection so the hover affordance only appears when a click will actually re-propose a slot.
