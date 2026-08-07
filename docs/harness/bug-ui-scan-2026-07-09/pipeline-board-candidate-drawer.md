# Pipeline Board & Candidate Drawer — bug-hunter + ui-perfectionist scan

> Context: The kanban-style hiring pipeline — drag candidates across stages, open a candidate drawer with full timeline and result, stream live updates.
> Files reviewed: 16 of 31
> Total: 5

## 1. [STILL-OPEN] Drag-to-move across stages has no keyboard / assistive-tech equivalent on the board

- **Severity**: High
- **Lens**: ui-perfectionist
- **Category**: a11y
- **File**: `app/features/sub_pipeline/PipelineShared.tsx:222-237` (row `draggable` handlers), `app/features/sub_pipeline/PipelineBoard.tsx:77-94` (cell drop target), `app/features/sub_pipeline/CandidateDrawer.tsx:749-761` (the only keyboard alternative)
- **Scenario**: A keyboard-only or screen-reader recruiter wants to move a candidate from "Screened" to "Interview" directly on the board.
- **Root cause**: Still true a year on — the cross-stage move is pure native HTML5 `draggable` + `onDragOver`/`onDrop` pointer events. `CandidateRow` even documents the gap ("The keyboard path stays the row's open/select button + the bulk-move bar (drag is pointer-only)", lines 181-183). The row exposes no `aria-grabbed`/`aria-roledescription`, the cell has no roving-tabindex "move" affordance, and no `aria-live` narrates pick-up/drop. The only keyboard twin is the drawer's stage `<select>` — two clicks deep and undiscoverable from the board.
- **Impact**: The board's headline interaction is unusable without a pointer — a WCAG 2.1.1 failure on the feature's primary action. It matters more now because drag is the promoted way to advance candidates.
- **Fix sketch**: Add a per-row "Move to…" menu button (reuse `openActions`/a small stage list calling `onMove`) so every drag has a keyboard twin, and an `aria-live` region in `PipelineBoard` announcing "Moved X to Interview". Make DnD an enhancement over an always-present accessible control.

## 2. Move-stage dropdown offers "Hired", which the server always rejects, and the drawer swallows the explanatory 422 into a generic "move failed"

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: missing-ui-state / misleading-affordance
- **File**: `app/features/sub_pipeline/CandidateDrawer.tsx:757-760` (options), `:296-305` (`moveStage` error handling); `app/api/pipeline/[id]/route.ts:124-129` (422 guard)
- **Scenario**: A recruiter opens the drawer, picks "Hired" from the "Move to stage" dropdown to record a hire.
- **Root cause**: The `<Select>` maps over the full `PIPELINE_STAGES` (`["Accepted","Screened","Interview","Offer","Hired"]`), so "Hired" is a selectable target. But the route unconditionally 422s any manual move to Hired ("Hired is set when the candidate accepts an offer…"). `moveStage`'s catch discards `data.error` and shows the generic `t("moveFailed")` — so the recruiter sees "move failed" with none of the actual guidance (route through Offer → extend an offer).
- **Impact**: A dead control that always errors, plus a confusing generic message that hides the one sentence explaining what to do instead. The recruiter is stuck without knowing why.
- **Fix sketch**: Drop "Hired" from the drawer's options (`PIPELINE_STAGES.filter(s => s !== "Hired")`, mirroring the SLA editor which already filters it) and surface the server's `data.error` verbatim when present instead of the blanket `moveFailed`.

## 3. Command-bar `reject_below` is a preview→confirm TOCTOU: the executed set is recomputed and can differ from the reviewed preview

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: race-condition
- **File**: `app/api/pipeline/command/route.ts:66-68` (preview), `:77` (execute re-runs `affected(cmd)`), `:85-106` (reject + `dispatchRejection`)
- **Scenario**: A recruiter previews "reject and notify candidates below 60%", reviews the named list, then clicks confirm. Between the two POSTs an inbound applicant is scored at 55% (or a background screen wave lands one below the line).
- **Root cause**: Preview and execute each independently call `affected(cmd)` → `listPipeline()` against live DB state; the confirm request carries only `{text, confirm:true}`, not the previewed id set. So execute acts on whoever matches *now*, not the cohort the operator vetted. For an irreversible, email-sending bulk reject this means a candidate the recruiter never saw can be rejected and notified.
- **Impact**: Silent over-reach on the most destructive pipeline action — a consent/trust problem for an Art. 22-relevant adverse decision, not just a count mismatch.
- **Fix sketch**: Return a preview token / the concrete id list, and on confirm act only on the intersection of {still-matching} ∩ {previewed ids}; report any that dropped out. Make "confirm executes exactly what was shown" the contract.

## 4. Native DnD has no drop-target auto-scroll — a candidate can't be dropped onto a stage column scrolled out of view

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: responsiveness
- **File**: `app/features/sub_pipeline/PipelineBoard.tsx:20-23` (`min-w` = 240 + 5×280 = 1640px), `:79-92` (drop handlers), `:177-195` (manual centre/page scroll only)
- **Scenario**: On a ~1440px (or smaller) viewport the board overflows horizontally. A recruiter grabs a card in "Accepted" and wants to drop it on "Offer", which is off the right edge.
- **Root cause**: Movement across columns relies on the target cell being a live drop target, but the scroll container has no `dragover`-edge auto-scroll; the only scroll paths (`scrollByColumn`, `centerColumn`) are click-driven and can't be used mid-drag. HTML5 DnD doesn't auto-scroll for you. So off-screen stages are undroppable without releasing, scrolling, and re-dragging.
- **Impact**: The advertised drag interaction silently fails for exactly the multi-stage moves it exists for, on any board wide enough to overflow (the common case with 5 stages).
- **Fix sketch**: Add an `onDragOver` handler on the scroll region that scrolls left/right when the pointer nears an edge, or (better, and it also fixes finding #1) provide the keyboard/menu "Move to…" path so reaching an off-screen stage never requires a pixel-perfect drag.

## 5. Candidate-note autosave never clears its dirty flag: every drawer close after an edit re-POSTs the note and each debounced save reloads the whole board

- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: `app/features/sub_pipeline/CandidateDrawer.tsx:430` (`noteDirtyRef`), `:431-448` (debounce save → `onChangedRef.current()`), `:460-476` (unmount keepalive flush), `:784-788` (onChange sets dirty true — nothing ever sets it false)
- **Scenario**: A recruiter types call notes, the 600ms debounce saves them, then closes the drawer (immediately or minutes later).
- **Root cause**: `noteDirtyRef.current` is set `true` on the first keystroke and is never reset after a successful save. The unmount cleanup therefore always fires a second `set_notes` POST (keepalive) on close, and every debounced save also calls `onChanged()` = `load()`, refetching `/api/pipeline` + events behind the still-open drawer — which defeats the deliberate "pause the 30s poll while a drawer is open" guard (PipelineTab:262-264).
- **Impact**: Duplicate writes and repeated full-board refetches while editing a single note. No corruption (last-write-wins, same value), but wasteful and it thrashes the board the pause was meant to protect.
- **Fix sketch**: Set `noteDirtyRef.current = false` after a successful debounced save so the unmount flush only fires for a genuinely-unsaved trailing edit, and call `onChanged()` once on drawer close rather than on every autosave.
