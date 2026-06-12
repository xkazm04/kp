# Biz+UI Scan — Pipeline Board & Scheduler (2026-06-12)

> Total: 5 (1H/4M/0L)
> Prior scans (06-08, 06-10) verified: PIPE1 bulk select, PIPE2 filters, PIPE3 URL-sync + copy-link, PIPE4 per-stage SLAs, PIPE5 saved views, AUTO2 run history, AUTO3 pass preview, AUTO6 reminders row all SHIPPED. Findings below are net-new seams those features opened, plus deltas against the 529f7a0 design system. Known/deferred items (drag-and-drop, owner/Mine, bulk screen/reject batch, sla_breach event, events full-detail mode, …) deliberately not re-flagged.

## 1. Give the recruiter a persistent per-candidate note on the pipeline entry
- **Lens**: business_visionary
- **Severity**: High
- **Category**: functionality
- **File**: `app/features/sub_pipeline/CandidateDrawer.tsx:594`
- **Scenario**: A recruiter finishes a phone call ("wants 80k, available from August, prefers hybrid") and opens the candidate's drawer to record it. There is nowhere to put it: the only textarea (`CandidateDrawer.tsx:596-604`) appears solely at Interview stage as fuel for the AI scorecard task, lives in transient state (`notes`, line 60), and is wiped the moment the drawer closes (drawer remounts per entry via `key={drawerEntry.id}`, `PipelineTab.tsx:909`). Recruiters fall back to external docs, breaking the single-workspace promise.
- **Root cause**: `pipeline_entries` has no notes column (`app/_lib/db.ts:263-291` — full schema: stage/score/approval/intake/contact only). Notes exist elsewhere in the system (`analyses.decision_note` db.ts:153, `dev_submissions.notes` db.ts:4032) but never on the funnel object the recruiter actually works. The drawer already aggregates every OTHER memory stream (history, comms, scorecards, GitHub evidence) — the recruiter's own observations are the one stream with no home.
- **Impact**: Context evaporates between touchpoints; the next action (offer calibration, scheduling constraints, rejection rationale) is made without the call notes. This is table-stakes in every ATS — its absence is the kind of gap that sends a user back to their spreadsheet.
- **Fix sketch**: Nullable `notes TEXT` via the existing idempotent-ALTER list (db.ts:504 pattern); thread through `rowToEntry`/`listPipeline` and `Entry` (`PipelineTypes.ts:4`); a `set_notes` action on `POST /api/pipeline/[id]` next to `set_stage`/`resolve_intake`; an always-visible, debounced-save textarea in the drawer (PREP5's free-text interviewer field is the precedent — single write path, no auth). Pre-fill the scorecard task's notes from it so the existing AI flow gets richer input for free.

## 2. Surface the candidate's booking state in the drawer that minted the link
- **Lens**: business_visionary
- **Severity**: Medium
- **Category**: user_benefit
- **File**: `app/features/sub_pipeline/CandidateDrawer.tsx:689`
- **Scenario**: The recruiter creates a self-scheduling link in the drawer (lines 689-710), sends it, and two days later opens the same drawer asking the most common post-invite question: "did they book?" The drawer says nothing — it only shows the mint-a-link button. The answer lives in the Schedule tab's full-agenda lifecycle panel, so the recruiter tab-hops and scans all invites. Worse, the stall flags written precisely for operator attention — `needs_more_slots` ("candidate found zero open slots") and `needs_reconcile` ("booked but the entry didn't advance") — never reach the surface where this candidate is being worked.
- **Root cause**: Invite state is queryable per entry (`idx_sched_entry`, `app/_lib/schedule-store.ts:64`) but the only recruiter read is the unfiltered `GET /api/schedule` → Schedule tab (`app/api/schedule/route.ts:13-19`). The drawer's history shows a `scheduled` event only AFTER the pipeline advances (`db.ts:4179`); a pending invite, the confirmed slot time, or a stalled booking are invisible here (grep `slot|booking` in sub_pipeline → only the STAGE_HELP prose).
- **Impact**: Stalled bookings (the exact edge the flags were built for) surface one tab away from where action happens; recruiters re-send links that were already booked or miss candidates silently stuck on an empty slot horizon — direct interview no-show/slippage risk.
- **Fix sketch**: Add `?entry=` filtering to `GET /api/schedule` (or a `listInvitesForEntry()` riding the existing index); in the self-scheduling panel render one status line per latest invite: moss "Booked — Mon 1 Jun · 10:00" (slot/slotAt), neutral "Link sent Xd ago — not yet booked", amber `needs_more_slots`/`needs_reconcile` rows reusing the drawer's existing tone grammar. Best-effort fetch like the comms/history loads (lines 185-214).

## 3. Stop a failed pass/preview from unmounting the whole board
- **Lens**: ui_perfectionist
- **Severity**: Medium
- **Category**: ui
- **File**: `app/features/sub_pipeline/PipelineTab.tsx:600`
- **Scenario**: The board is loaded and healthy. The recruiter clicks "Run pass" while the dev server hiccups (or offline): the entire board — filter bar, saved views, lanes, activity feed — vanishes, replaced by a single red line "pass failed". It stays gone until the next 30s poll happens to succeed.
- **Root cause**: One `error` state serves two unrelated failure classes. `previewPass`/`runPass` write it on POST failure (lines 484-489, 507-510), and the render tree treats ANY `error` as "board unavailable": `{error ? <p role="alert"> : entries == null ? loading : ...}` (lines 600-605) — discarding the perfectly valid `entries` already in state. The codebase already solved this exact problem for the feed: `eventsError` is tracked separately so a fetch blip "must read as 'couldn't load activity', never as a genuine empty feed" (lines 90-92).
- **Impact**: A transient action failure reads as catastrophic data loss; the recruiter loses their filter context and selection mid-task for up to 30 seconds. Error severity wildly mismatches the actual fault.
- **Fix sketch**: Split a `passError` state (mirroring `eventsError`); render it as the existing dismissible amber/red banner pattern above the action row, and reserve the full-board error branch for genuine load failures (`load()`'s catch only). Three-line change, no new UI vocabulary.

## 4. Wire every header stat chip to its cohort — and stop "Needs intake" at degraded[0]
- **Lens**: ui_perfectionist
- **Severity**: Medium
- **Category**: ui
- **File**: `app/features/sub_pipeline/PipelineTab.tsx:528`
- **Scenario**: Six identical-looking StatChips sit in the header; clicking them does three different things. "Aging 7" filters the board to those 7 (line 533, the right grammar). "Interview 12" does nothing — it's inert (line 528) even though the matching `interview` quick filter exists one row below (line 72, 651). "Needs intake 4" (lines 535-541) and the red banner (lines 608-623) both open the drawer of `degraded[0]` only — to reach stub #3 the recruiter must resolve #1 and #2 first, or hunt the red dots across lanes by eye.
- **Root cause**: PIPE2 shipped the chip→filter wiring for `aging` only; `interview` got a chip and a filter but no wire between them, and the degraded affordances predate the `intake` quick filter (line 298) so they still hardcode first-element drawer-open instead of filtering to the flagged cohort.
- **Impact**: Identical affordances with divergent behavior erode click-confidence in the whole header; the degraded path actively hides N-1 of the entries it warns about, which delays intake recovery — those stubs are unmatchable until captured.
- **Fix sketch**: `statInterview` chip → `toggleQuick("interview")`; "Needs intake" chip and banner → `toggleQuick("intake")` (board then shows every flagged card with its red triangle; keep direct drawer-open only for the `degradedCount === 1` case). Pure rewiring of existing handlers — no new state.

## 5. Finish saved views: themed naming dialog and capture the stage dimension
- **Lens**: ui_perfectionist
- **Severity**: Medium
- **Category**: ui
- **File**: `app/features/sub_pipeline/PipelineTab.tsx:362`
- **Scenario**: Saving a view pops the browser-native `window.prompt()` — an unthemed OS dialog inside an app that just shipped a meticulous dual-theme design system (529f7a0, Studio Light / Spark Dark). And if the recruiter saves while a stage filter is active (the `?stage=` deep link from analytics), the saved view silently drops it: re-applying shows a different cohort than the one they saved, and "Copy link" shares the wrong view too.
- **Root cause**: `saveView` uses `window.prompt` (line 362) — the only native dialog in the sub_pipeline surface; the app's `Modal` component (used by PassPreviewModal in this same file) is the established pattern. `SavedView = { query, quick }` (line 76) omits `stage`, so `saveView` (360-365), `copyViewLink` (352), `activeViewId` matching (359) and `applyView` (366-370, which also leaks the CURRENT stage filter into an applied view) all operate on an incomplete snapshot of the three-dimensional filter state (`q`/`quick`/`stage`, lines 116-127).
- **Impact**: The native prompt breaks both theme registers and cannot be styled or keyboard-trapped consistently; the dropped stage dimension makes saved/shared views quietly wrong — the worst kind of wrong for a feature whose whole value is "return to exactly this view".
- **Fix sketch**: Extend `SavedView` with `stage: string | null` (older localStorage rows parse as `undefined` → treat as null, no migration needed) and thread it through save/apply/copy/active-match; replace `prompt()` with a small inline name input that appears in place of the "Save view" pill (or a compact `Modal`), reusing the `FIELD` recipe from `app/_components/ui/recipes.ts` so it lands theme-correct in both registers.

---
## Cross-checks
- Shipped-since-06-10 verified in code: bulk select (`PipelineTab.tsx:130-134, 373-424`), URL write-back (`:310-347`), copy-view-link (`:350-357`), SLA editor (`:789-811`), run history (`SchedulerControl.tsx:343-403`), pass preview (`PassPreviewModal.tsx`), reminders row (`SchedulerControl.tsx:408-445`).
- Design-token audit: every status shade used in sub_pipeline (red-50/100/200/600/700, amber-50/200/400/600/700, stone-50..400, white) is mapped in the `[data-theme="dark"]` seam (`app/globals.css:102-165`) — no unmapped-shade violations found. Residual nits not promoted to findings: 9× `text-xs` in SchedulerControl below the documented 14px type floor (globals.css:54); always-rendered but no-op "Open full match" when `candidateId` is null (CandidateDrawer.tsx:716-725, while "Edit profile" correctly hides at :726).
- Not re-flagged: drag-and-drop, owner/Mine filter (06-10 #2/#4 still open but KNOWN); bulk screen/reject (adjacent to deferred "advance lead, reject rest"); events full-detail mode / initials-only feed labels (explicitly deferred); sla_breach server event (PIPE4 deferral).
