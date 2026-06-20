# Pipeline Board & Candidate Drawer — Tri-Lens Scan
> Total: 5
> Severity: 0 Critical / 3 High / 2 Medium / 0 Low
> Lens: 2 bug / 1 ui / 2 biz

## 1. Open drawer freezes a stale candidate snapshot — live poll is paused, no CAS on the actions that aren't stage moves
- **Lens**: 🐛 Bug Hunter (primary)
- **Severity**: High
- **Category**: stale-snapshot / data race
- **Value**: impact 8/10 · effort 4/10 · risk 3/10
- **File**: `app/features/sub_pipeline/PipelineTab.tsx:271-277` (poll paused) + `app/features/sub_pipeline/CandidateDrawer.tsx:58,423,786` (frozen `entry` prop)
- **Scenario**: A recruiter opens a candidate's drawer to write call notes / draft an offer. The 30s board poll deliberately bails while a drawer is open (`if (drawerOpenRef.current || document.hidden) return;`). Meanwhile the automation clock (or a second recruiter) advances, rejects, or anonymizes that exact candidate server-side. The drawer keeps showing the old stage/status; the AI-action gate (`actions` filtered by `entry.stage`/`entry.status`, line 262-264) offers actions that no longer apply, and `set_notes` (last-write-wins, no `expectedStage` CAS — see `route.ts:127-141`) silently overwrites against a stale base.
- **Root cause**: The drawer is mounted once per candidate id (keyed remount) and never refetches that single entry; the only board refresh path is paused precisely when the drawer is open. Stage-changing actions are CAS-guarded (409 → reload+close), but `set_notes`, `set_github`, and the action-button visibility logic read a snapshot with no freshness check.
- **Impact**: Notes clobbered, actions taken on a candidate already rejected/hired, recruiter believes they acted on current state. Silent — no "this candidate changed" banner.
- **Fix sketch**: Poll the single entry while the drawer is open (`GET /api/pipeline/[id]` lightweight) on a 15-30s timer; diff stage/status and surface a non-destructive "Candidate changed — refresh" banner instead of yanking state. Keep the existing CAS for writes; the banner just makes the staleness observable.

## 2. Optimistic drag-move can visibly snap back then re-move when a concurrent poll lands mid-flight
- **Lens**: 🐛 Bug Hunter (primary)
- **Severity**: Medium
- **Category**: optimistic-update / interleaved refresh
- **Value**: impact 5/10 · effort 4/10 · risk 3/10
- **File**: `app/features/sub_pipeline/PipelineTab.tsx:498-512` (`moveEntry`) + `:257` (`useLiveRefresh(load)`) + `:271-277` (30s poll)
- **Scenario**: Recruiter drags a card to a new column. `moveEntry` restages optimistically, then `await postPipelineAction(...)`, then `await load()` in `finally`. If `useLiveRefresh` or the 30s interval fires its own `load()` during the in-flight POST (the drawer isn't open, so the poll is NOT paused), that poll resolves with server state where the card is still in the OLD stage — overwriting the optimistic `entries` and snapping the card back. When the POST's own `load()` lands, it jumps forward again. The abort machinery only discards stale *responses*; it does not prevent a freshly-issued, legitimately-newer poll from clobbering an un-committed optimistic mutation.
- **Root cause**: Optimistic local state and the server-fetch reducer both write `setEntries` with no per-entry "pending move" guard, so any `load()` that wins the gap reverts the optimistic change.
- **Impact**: Cards flicker/jump during normal dragging under live automation; looks broken, can cause a mis-click on a card that moved under the cursor.
- **Fix sketch**: Track in-flight optimistic moves in a ref (`Map<entryId, toStage>`); when reconciling a `load()` response, re-apply still-pending optimistic stages on top of the server snapshot until their POST resolves, then clear.

## 3. Drawer "Move stage" select lets a recruiter jump any candidate straight to Hired, bypassing the offer extend/accept flow
- **Lens**: 🚀 Business Visionary (primary)
- **Severity**: High
- **Category**: workflow integrity / journey dead-end
- **File**: `app/features/sub_pipeline/CandidateDrawer.tsx:737-750` (select renders all `PIPELINE_STAGES`) + `app/api/pipeline/[id]/route.ts:80-103` (`set_stage` accepts any valid stage)
- **Scenario**: The manual override select lists every stage including "Hired". A recruiter (or a fat-finger) sets stage = Hired directly. `set_stage` validates only that the stage is in `PIPELINE_STAGES` — it does NOT route through `extendOffer` (route.ts:191-194), which is the careful path that mints the offer token, emails the accept/decline link, and only moves to Hired when the candidate accepts (`/api/offer/[token]`). A direct Hired set creates a "hired" candidate with no offer record, no accepted offer, no comms — corrupting hire metrics and the candidate timeline.
- **Root cause**: The manual override treats Hired as just another stage; the business rule "Hired is reached only via candidate-accepted offer" lives only in the accept path, not enforced on `set_stage`.
- **Impact**: Phantom hires, broken offer/accept audit trail, wrong funnel + time-to-hire analytics, possible legal/comms gaps (no offer letter on a "hired" person).
- **Fix sketch**: Exclude "Hired" from the drawer override select (or gate it behind a confirm that explains it skips the offer flow); server-side, reject `set_stage` → "Hired" with a 409/400 directing to the offer flow, unless an accepted offer exists for the entry.

## 4. Kanban board drag is pointer-only — no keyboard path to move a card on the board, and no drag instructions for AT
- **Lens**: 🎨 UI Perfectionist (primary)
- **Severity**: Medium
- **Category**: accessibility (WCAG 2.1.1 keyboard)
- **File**: `app/features/sub_pipeline/PipelineShared.tsx:179-231` (`CandidateRow` drag is `draggable`, no key handlers) + `app/features/sub_pipeline/PipelineBoard.tsx:77-94` (drop zone is pointer DnD only)
- **Scenario**: A keyboard-only / screen-reader recruiter cannot move a candidate on the board: drag is HTML5 pointer DnD with no key-equivalent on the row, and the dragged cells/columns expose no `aria` describing a draggable item or a drop target. The documented fallback (open drawer → Move-stage select, or bulk-move bar) works but is undiscoverable and slow, and nothing tells AT users the cards are draggable at all.
- **Root cause**: Drag affordance is mouse-first by design (comment in CandidateRow: "drag is pointer-only"); the keyboard story was offloaded to other surfaces but never surfaced as an on-card affordance.
- **Impact**: Core board interaction unusable by keyboard/AT users; the visible "Drag to move" hint (PipelineBoard.tsx:202) has no keyboard analogue, an accessibility-compliance gap for a B2B product.
- **Fix sketch**: Add a per-row keyboard move (e.g. a small "move" button opening a stage menu, or `Space` to pick up + arrow keys to choose column with an `aria-live` announcement); add `aria-roledescription="draggable"` to rows and `aria-dropeffect`/labels to cells. Reuse the existing `moveEntry`.

## 5. A drag misdrop is silent and immediate — no undo, no confirmation, no toast
- **Lens**: 🚀 Business Visionary (primary)
- **Severity**: High
- **Category**: recoverability / pipeline UX expectation
- **File**: `app/features/sub_pipeline/PipelineBoard.tsx:300-305` (drop → `onMove`) + `app/features/sub_pipeline/PipelineTab.tsx:498-512` (`moveEntry` commits immediately)
- **Scenario**: Dropping a card on the wrong column immediately POSTs `set_stage` and records a `moved` event. There is no confirmation, no toast naming the move, and no Undo. A `moved` event may trigger downstream automation (the policy pass acts on stage). The only recovery is to open the drawer and manually move back — which leaves TWO stray `moved` events in the candidate's permanent timeline for what was a single accidental drag. Recruiters dragging a full board will misdrop; every misdrop pollutes the audit history and can mis-fire automation.
- **Root cause**: The drop path is fire-and-commit with optimistic UI but no post-move affordance; reversibility was never surfaced.
- **Impact**: Accidental stage changes are common in kanban; silent commit + permanent dual events erode trust in the timeline and can advance/expose candidates wrongly (e.g. drag into Offer fires offer-draft expectations).
- **Fix sketch**: After a drag-commit, show a brief toast — "Moved {name} → {stage}. Undo" — that re-POSTs `set_stage` back to the prior stage within a short window; or require a same-stage-row confirm for moves into Offer/Hired. Suppress the second timeline event when an Undo immediately reverses.
