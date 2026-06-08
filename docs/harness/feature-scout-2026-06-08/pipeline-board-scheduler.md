# Feature Scout — Pipeline Board & Scheduler (kp)

> Total: 6 opportunities (High: 3, Medium: 2, Low: 1)
> Files read: ~12

## 1. Manual stage move from the board (advance, send back, or skip a stage)
- **Value**: High
- **Category**: functionality
- **Effort**: M
- **Where it slots in**: `app/_lib/db.ts:3048` — `PipelineAction = "accept" | "reject" | "approve_event"`; consumed at `app/api/pipeline/[id]/route.ts:10` and surfaced (or rather not) in `app/features/sub_pipeline/CandidateDrawer.tsx:227`
- **Gap**: The only stage transitions a recruiter can trigger by hand are `accept` (advance exactly one step) and `reject`. There is no way to move a candidate **backward** (e.g. Interview → Screened after a no-show), **skip** a stage, or correct a miscategorized entry. Everything else is AI-action- or automation-driven. A real ATS lets a recruiter drag/override.
- **Opportunity**: Add a `set_stage` action (`{ action: "set_stage", toStage, expectedStage }`) reusing the existing optimistic-concurrency CAS, plus a stage dropdown in the drawer header next to `entry.stage`.
- **Why it matters**: Recruiters constantly correct pipeline state by hand; today a misplaced candidate is stuck unless an AI action happens to move it.
- **Sketch**: Extend `actOnPipelineEntry` with a guarded direct-stage write that validates `toStage ∈ PIPELINE_STAGES`, logs an `advanced`/manual event, stamps `stage_changed_at`; add a `<select>` in the drawer wired to `POST /api/pipeline/[id]`.

## 2. Board search + quick filters (stage, archetype, aging, awaiting-you)
- **Value**: High
- **Category**: feature
- **Effort**: M
- **Where it slots in**: `app/features/sub_pipeline/PipelineTab.tsx:131` (positions/entries memo) and `PipelineBoard.tsx:163` (lane render)
- **Gap**: The board renders every position and every entry with no way to search by candidate name or filter. The header StatChips (`Aging>10d`, `Awaiting you`, `Needs intake`) are summary numbers — most aren't even clickable, so a recruiter who sees "7 aging" cannot jump to those 7. Cells also cap at `CELL_LIMIT = 6` with a "+N more" — a busy column hides candidates behind a click with no way to filter down.
- **Opportunity**: A filter bar above the board: free-text name search plus toggle chips for stage, archetype, aging, awaiting-decision, intake-degraded. Make the existing StatChips the toggles.
- **Why it matters**: At realistic volume (multiple positions × dozens of candidates) the board is unusable without find/filter; this is table-stakes ATS navigation.
- **Sketch**: Add `filter` state in `PipelineTab`; derive a filtered `entries` array before passing to `PipelineBoard`; have each StatChip set the matching filter; highlight matched `CandidateRow`s.

## 3. Per-candidate activity timeline in the drawer
- **Value**: High
- **Category**: user_benefit
- **Effort**: M
- **Where it slots in**: `app/features/sub_pipeline/CandidateDrawer.tsx:285` (where the interview-outcome block ends, before "AI actions") — data via `app/api/pipeline/events/route.ts` / `listPipelineEvents`
- **Gap**: A rich event taxonomy already exists (`EVENT_CATALOG` in `PipelineShared.tsx:53`: matched, applied, advanced, scheduled, rejected, intake_*, plus automation kinds) and a *global* activity feed renders it (`PipelineTab.tsx:326`). But the drawer for a single candidate shows only AI actions + the latest interview outcome — there is **no per-candidate history**. A recruiter opening a candidate can't see "applied 12d ago → screened → advanced to Interview by automation → scheduled".
- **Opportunity**: A "History" section in the drawer listing this entry's events oldest→newest, reusing `EventDot` + `eventVerb`.
- **Why it matters**: The single most-asked ATS drawer feature — the story of how a candidate got where they are, who/what moved them, and when.
- **Sketch**: Add `listPipelineEventsForEntry(entryId)` + `GET /api/pipeline/events?entry=<id>`; render in the drawer with the existing `EventDot`/`eventVerb` (already imported pattern from `PipelineShared`).

## 4. Configurable per-stage SLA / aging thresholds (replace the single global STALE_DAYS)
- **Value**: Medium
- **Category**: functionality
- **Effort**: M
- **Where it slots in**: `app/features/sub_pipeline/PipelineTypes.ts:53` (`STALE_DAYS = 10`) and `PipelineTab.tsx:144` (`isStale`)
- **Gap**: Aging is one hardcoded constant (`STALE_DAYS = 10`) applied uniformly to every stage. But a candidate sitting 10 days in *Offer* is a crisis while 10 days in *Accepted* is normal — the funnel needs different SLAs per stage. There's no config surface and no per-stage tuning.
- **Opportunity**: Per-stage SLA thresholds (e.g. Accepted 14d, Screened 7d, Interview 5d, Offer 3d), stored in the scheduler/settings store, with the board's amber aging cue driven per-stage and an SLA-breach alert kind the policy pass can log.
- **Why it matters**: Stage-appropriate SLAs are how teams actually catch stalls; a flat 10-day rule both over- and under-flags.
- **Sketch**: Add a `stage_sla` table (mirror `scheduler-store.ts`); make `isStale(e)` look up `SLA[e.stage]`; surface editable thresholds in `SchedulerControl` or a small settings popover; emit an `sla_breach` automation event.

## 5. Saved board views (per-position focus + filter presets)
- **Value**: Medium
- **Category**: functionality
- **Effort**: M
- **Where it slots in**: `app/features/sub_pipeline/PipelineBoard.tsx:163` (position lanes) and the new filter bar from #2
- **Gap**: The board always shows **all** positions in one wide horizontal grid (`BOARD_MIN_WIDTH` = 240 + stages×280px); the only navigation is centre-a-column and ◀/▶ paging (`PipelineBoard.tsx:100-118`). A recruiter who owns 3 of 20 reqs has no way to scope the board to just those, and no way to save a filter combination they return to daily.
- **Opportunity**: Saved views — a named preset of {selected positions, filter chips, search} persisted (localStorage or a `board_views` table), shown as tabs/pills above the board.
- **Why it matters**: Multi-recruiter teams each work a slice of the funnel; scoping + presets turn an unwieldy all-reqs board into a personal worklist.
- **Sketch**: Build on #2's filter state; add a "Save view" control that snapshots the filter + position selection; render saved views as selectable pills; a position multi-select drives `positions.filter(...)` in `PipelineTab`.

## 6. Scheduler run-history panel (the durable log already exists, but is never shown)
- **Value**: Low
- **Category**: user_benefit
- **Effort**: S
- **Where it slots in**: `app/features/sub_pipeline/SchedulerControl.tsx:227` (only `lastRunAt` + last summary shown) — data already available via `listRuns()` in `app/_lib/scheduler-store.ts:225`
- **Gap**: Every automation tick is durably recorded in `scheduler_runs` with trigger, status, summary, error, and timing (`recordRun`/`listRuns`), but the UI surfaces only the **single most recent** run's summary. There's no way to see the last N runs, spot a run that errored, or confirm the clock has been firing on cadence — the history is written and then invisible.
- **Opportunity**: An expandable "Run history" disclosure under the Automation clock showing the last ~10 runs (time, trigger clock/manual, advanced/rejected/held/alerts, or the error).
- **Why it matters**: Operators need to trust the automation clock; a visible run log makes silent failures and cadence drift observable instead of buried in SQLite.
- **Sketch**: Add `GET /api/automation/schedule/runs` → `listRuns(10)`; render a collapsible list in `SchedulerControl` reusing `SummaryBadges` + `relativeTime`; error rows in the existing coral tone.
