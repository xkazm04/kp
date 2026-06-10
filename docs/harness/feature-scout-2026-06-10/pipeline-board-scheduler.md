# Feature Scout — Pipeline Board & Scheduler (2026-06-10, re-scan of mined context)

> Total: 4 (1H/3M/0L)
> Prior scan 2026-06-08: 6 findings, PIPE1-5 shipped, PIPE6 retired. This re-scan reports only net-new gaps.

## 1. Bulk multi-select board actions (select candidates → move/screen them as a batch)
- **Value**: High
- **Category**: functionality
- **Effort**: M
- **Where**: `app/features/sub_pipeline/PipelineBoard.tsx:40` (StageCell) + `PipelineShared.tsx:136` (CandidateRow); backend already complete at `app/_lib/db.ts:3264` (`setPipelineEntryStage`) and `app/api/pipeline/[id]/route.ts:58` (`set_stage` with expectedStage CAS). Precedent: `app/features/sub_matrix/MatrixTab.tsx:77` (`selectMode` shortlist).
- **Gap**: A seam opened by what shipped: PIPE1 gave single-candidate stage moves (drawer dropdown only) and PIPE2's filters can isolate "7 aging" or "5 awaiting" — but acting on them is still one-drawer-at-a-time. No multi-select exists anywhere in `sub_pipeline` (grep `selectMode|multiSelect|selected` → 0 hits); the only batch operations are all-or-nothing (`batch_screen` everything, per-role screening wave in Decisions).
- **Proposal**: A "Select" toggle on the board (MatrixTab's `selectMode` precedent) that flips CandidateRow clicks to checkbox selection; an action bar offers "Move N to <stage>" (sequential `set_stage` POSTs, each carrying its own `expectedStage` — a 409 leaves that candidate selected for retry, the MatrixTab W11 failure-retention pattern) and optionally "Screen N with AI" via the existing per-entry automation task. Works naturally on a filtered board: filter to aging → select all → act.
- **Why users need it**: At realistic volume the filter bar finds the stalled cohort but the recruiter still pays N open-drawer round-trips to act on it; batch-acting on a filtered set is the payoff the filters set up.

## 2. Drag-and-drop a candidate card between stage columns
- **Value**: Medium
- **Category**: user_benefit
- **Effort**: M
- **Where**: `app/features/sub_pipeline/PipelineBoard.tsx:206` (the per-stage cells) + `PipelineShared.tsx:176` (the card); reuses `POST /api/pipeline/[id]` `set_stage` (`app/api/pipeline/[id]/route.ts:58`) unchanged.
- **Gap**: Net-new seam from PIPE1 shipping: the manual-move backend (CAS, terminal-status guard, `moved` event) is complete, but the only gesture is open-drawer → `<select>` (`CandidateDrawer.tsx:436`). The kanban board itself — the surface whose entire metaphor is cards in columns — has zero drag affordance (grep `drag|onDrop|draggable` in sub_pipeline → only a scrollbar comment).
- **Proposal**: HTML5 drag on CandidateRow (`draggable`, payload = entry id + current stage) with drop targets on each StageCell in the same lane; drop fires `set_stage` with `expectedStage` = the stage the card was lifted from, optimistically moves the card, and a 409 snaps back + reloads. Keep the drawer dropdown as the keyboard/screen-reader path so a11y doesn't regress.
- **Why users need it**: Drag-to-move is the expected interaction on any ATS board; today a one-stage correction costs three clicks and a modal.

## 3. Shareable board-view URLs (sync search/filter to the query string + "Copy link" on saved views)
- **Value**: Medium
- **Category**: feature
- **Effort**: S
- **Where**: `app/features/sub_pipeline/PipelineTab.tsx:97-98` (`query`/`quick` state, never URL-synced) and `:70-71` (SavedView, localStorage-only); `app/features/tabs.ts:153` — the TAB_SCOPED_PARAM_KEYS comment already anticipates "a future global/filter param".
- **Gap**: PIPE5's saved views are per-browser localStorage — they can't be bookmarked, opened in a second window, or sent to a colleague, and the board's filter state vanishes on every navigation. This is the cheapest multi-recruiter-lite share path (no auth layer needed: the view IS the URL).
- **Proposal**: Mirror `query`/`quick` into query params (e.g. `pq`/`pf`) via `router.replace(buildUrl(...))` and hydrate them on mount; add a "Copy link" affordance on each saved-view pill (reuse `copyText` from `app/_lib/export-utils.ts`). Mark the new params tab-scoped in `TAB_SCOPED_PARAM_KEYS` so they don't leak across tab switches.
- **Why users need it**: "Look at these 4 stalled Interview candidates" becomes a pasteable link instead of dictated filter steps; a recruiter's daily view becomes a bookmark.
- **Coordination note**: the analytics scout this run claims deep-links INTO the board filter — those links would ride exactly these params. The board-side param read/write is the shared substrate; implement once, together. (Not a duplicate: this finding is the board's own two-way URL sync + share affordance, not the analytics-side links.)

## 4. Per-candidate owner ("who's working this one") + a Mine filter — multi-recruiter-lite
- **Value**: Medium
- **Category**: functionality
- **Effort**: M
- **Where**: `pipeline_entries` in `app/_lib/db.ts` (no owner/assignee column — grep verified), `PipelineTypes.ts:3` (Entry), `CandidateDrawer.tsx:316` (header), `PipelineTab.tsx:451` (quick-filter chips). Precedent: PREP5's free-text interviewer field on the prep artifact (one debounced write path, no auth).
- **Gap**: The board is single-recruiter-implicit: entries carry no notion of who owns the candidate, so two people working one funnel can't split it ("you take Data, I take Platform" lives in their heads). PREP5 assigns an interviewer to a prep session, but pipeline ownership doesn't exist anywhere. Explicitly does NOT need the auth layer — same trust model as PREP5's interviewer name.
- **Proposal**: Nullable `owner` TEXT column via the existing idempotent-ALTER migration pattern, threaded through `PipelineRow`/`rowToEntry`/`listPipeline`; an "Owner" field in the drawer header (datalist of names already used); a "Mine" quick-filter chip driven by a localStorage display-name (set once, like the SLA overrides), plus owner initials on CandidateRow's title tooltip. Optionally an `owner` facet in the filter bar.
- **Why users need it**: It turns the all-candidates wall into per-person worklists — the single biggest "two recruiters, one board" need that doesn't require accounts.

---
## Cross-checks performed
- **Prior findings verified shipped (not re-proposed)**: PIPE1 `set_stage` (`api/pipeline/[id]/route.ts:58` + drawer `<select>` `CandidateDrawer.tsx:436`); PIPE2 filter bar (`PipelineTab.tsx:441-508`); PIPE3 drawer History (`CandidateDrawer.tsx:417` + `events/route.ts?entry=`); PIPE4 per-stage SLAs (`PipelineTypes.ts:60`, localStorage editor `PipelineTab.tsx:510`); PIPE5 saved views (`PipelineTab.tsx:69-121`). PIPE6 run-history: `listRuns` (`scheduler-store.ts:229`) is still UI-less, but that territory is claimed by the automation-orchestration scout this run — deliberately NOT reported here.
- **Adjacent-scout collisions avoided**: SLA breach events/notifications (W16-deferred `sla_breach` server event — automation scout's pause/notification territory, skipped); per-pass decisions-log/run-history (automation scout); analytics→board deep-links (flagged as shared substrate on finding 3, not duplicated); attention badges/recents (shell scout); profile CRUD from drawer (profile scout); human scorecard in drawer (shipped W10, present at `CandidateDrawer.tsx:391`).
- **Greps**: `drag|onDrop|draggable|dnd` (app-wide → only sub_analyze file-drop + a scrollbar comment in PipelineBoard); `selectMode|multiSelect|selected` in sub_pipeline (0 hits; MatrixTab.tsx:77 confirmed as the precedent); `owner|assignee|recruiter_` in db.ts (only a JD prose hit — no column); `tab=pipeline|filter=|quick=` app-wide (all board links are bare `tab=pipeline`; no filter params exist anywhere).
- **Reads**: PipelineTab.tsx, PipelineBoard.tsx, PipelineShared.tsx, PipelineTypes.ts, CandidateDrawer.tsx, CandidateDrawerTypes.ts, CandidateResultView.tsx, SchedulerControl.tsx, api/pipeline/route.ts, api/pipeline/[id]/route.ts, api/pipeline/events/route.ts, _lib/scheduler.ts, _lib/scheduler-store.ts, db.ts (listPipeline:1637, setPipelineEntryStage:3264), tabs.ts, seed_pipeline.py (head), prior report + INDEX + harness-learnings (W1/W4/W5/W15/W16, bug-hunt W8).
- **i18n angle checked**: the surface is fully localized (useEventVerb/useRelativeTime/enumLabel hooks, stageHelp catalog); no pipeline-board feature gap opened by i18n itself — candidate-facing comms language preference belongs to the comms/apply surface, not this board, so not reported.
