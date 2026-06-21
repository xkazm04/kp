# Group Evaluation & Fairness — UI Perfectionist scan

> Context: Side-by-side group evaluation of shortlisted candidates with per-candidate tabs, comparison tables, differentiators, risks and a fairness panel.
> Files reviewed: 16 of 20
> Total: 7 findings — Critical: 0, High: 3, Medium: 3, Low: 1

## 1. Inline "Advance/Reject" shows a fake success pill when the candidate already left the pool

- **Severity**: High
- **Category**: optimistic-feedback / misleading-affordance
- **File**: `app/features/sub_decisions/group-eval/useGroupEval.ts:24` (and `app/features/sub_decisions/DecisionsTab.tsx:466`)
- **Scenario**: A recruiter opens a cached group eval, and one of the listed candidates was already advanced/rejected elsewhere (or in another tab) so they are no longer in `evalGroup.entries`. The recruiter clicks **Advance** in the per-candidate tab.
- **Root cause**: `decide()` in `useGroupEval` *unconditionally* writes the optimistic `decided[identity]` state and calls `onDecide(...)` before any work happens. The `onDecide` handler in `DecisionsTab` resolves the identity back to a live entry with `find(...)` and, if none is found, **silently does nothing** (`if (e) void act(...)`). No `act()` runs, no `expectedStage` CAS, no error — but the tab and the `CandidateDetail` button both flip to a green "Advanced" pill (`PerCandidateTabs.tsx:180`, `:74`).
- **Impact**: The UI tells the recruiter an irreversible hiring action succeeded when nothing was recorded. The pill is sticky for the session (`if (decided[label]) return;`), so they cannot retry. This is a trust-critical lie on a hiring decision surface.
- **Fix sketch**: Make `onDecide` return a success boolean (resolve-then-act), and only set `decided` when it resolves to a live entry. On a miss, surface an inline "candidate no longer pending — refresh" notice instead of a success pill.

## 2. Comparison table and Fairness matrix can list candidates in two different orders

- **Severity**: High
- **Category**: visual-consistency / confusing-data
- **File**: `app/features/sub_decisions/group-eval/FairnessPanel.tsx:58` (vs `ComparisonTable.tsx:179`), data from `app/_lib/group-eval-run.ts:351`
- **Scenario**: Any role where the recruiter ranker's row order differs from the final ko-aware/score sort. `candidates` is re-sorted in `group-eval-run.ts` (`koPassed` first, then score) *after* `fairness.labels`/`candidateIds` were captured from the raw recruiter rows.
- **Root cause**: The Comparison table renders the sorted `candidates` array (rank 1..N, "Lead" crown on index 0). The Fairness matrix renders `fairness.labels` in its own order. Nothing re-aligns the two, and the modal stacks them in the same scroll.
- **Impact**: In the same modal a recruiter sees "Candidate A is the lead/rank 1" in one table and a fairness matrix whose first row/column is a different person — reads as a contradiction and undermines the fairness story the panel is meant to tell.
- **Fix sketch**: Order the fairness rows/columns by the same canonical `recommendedOrder`/`candidates` sequence (map `candidateIds`→display index), or render the rank number beside each fairness label so the orders are visibly reconciled.

## 3. Tabs are not keyboard-operable and lack `aria-controls`/`id` wiring

- **Severity**: High
- **Category**: a11y
- **File**: `app/features/sub_decisions/group-eval/PerCandidateTabs.tsx:160` (tablist), `:191` (tabpanel)
- **Scenario**: A keyboard or screen-reader user reaches the per-candidate `role="tablist"` and tries to move between candidates with Arrow keys.
- **Root cause**: The `role="tab"` buttons handle only `onClick`; there is no `onKeyDown` for ArrowLeft/ArrowRight, no roving `tabIndex`, and no `id`/`aria-controls`/`aria-labelledby` linking each tab to the single `role="tabpanel"` (which also has no `id` or `tabIndex`). This violates the WAI-ARIA tabs pattern.
- **Impact**: Screen readers don't announce the tab↔panel relationship, and keyboard users must Tab through every tab button instead of arrowing. For a comparison surface driving hiring decisions, the detail view is effectively second-class for AT users.
- **Fix sketch**: Add a shared `useTabs` helper: roving `tabIndex` (0 on active, -1 on others), ArrowLeft/Right/Home/End handling, and `id={tabId}`+`aria-controls={panelId}` on tabs with `id={panelId}`+`aria-labelledby={tabId}`+`tabIndex={0}` on the panel.

## 4. "Rerun" footer button is a dead control in the simulation

- **Severity**: Medium
- **Category**: dead-control / misleading-affordance
- **File**: `app/features/simulation/SimGroupEval.tsx:18` (button rendered by `GroupEvalModal.tsx:76`)
- **Scenario**: During the guided simulation's Offer step the real `GroupEvalModal` is reused with `onRerun={() => undefined}`. The footer always renders an enabled "Rerun" button.
- **Root cause**: The modal renders the Rerun button unconditionally; the simulation passes a no-op handler instead of suppressing the affordance. The button looks identical to the live one but does nothing on click.
- **Impact**: A demo viewer clicks "Rerun", sees no feedback, and assumes the product is broken — exactly the wrong impression in a sales/onboarding demo.
- **Fix sketch**: Make `onRerun` optional in `GroupEvalModal` and skip the footer when it's absent (or render the button `disabled` with a tooltip in read-only/sim mode).

## 5. No empty state when a successfully-run evaluation has zero candidates

- **Severity**: Medium
- **Category**: missing-empty-state
- **File**: `app/features/sub_decisions/GroupEvalModal.tsx:99` (and `LegacyView.tsx:27`, `PerCandidateTabs.tsx:153`)
- **Scenario**: `runGroupEval` produces a valid payload but `candidates` is empty (e.g. all entries had no resolvable candidateId, or a role whose pool emptied), so `summary` reads "No candidates to evaluate…".
- **Root cause**: The modal only branches on `loading` / `error` / `!evaluation`. With a non-null `evaluation` and `enriched === false`, it renders `LegacyView`, which guards every section on `?.length` and returns an essentially blank body. `PerCandidateTabs` returns `null` on an empty list. There is no dedicated "0 candidates" panel.
- **Impact**: The recruiter sees a near-empty modal with only the AI-verdict summary text and no explanation of why the comparison is blank — looks like a load failure rather than an intentional empty result.
- **Fix sketch**: Add an explicit empty state (`evaluation && (candidates?.length ?? 0) === 0`) with an icon, the reason, and a "Re-run" CTA, before falling through to `LegacyView`/`enriched`.

## 6. Salary bar renders a misleading band even when no candidate column is comparable

- **Severity**: Medium
- **Category**: misleading-visualization
- **File**: `app/features/sub_decisions/group-eval/ComparisonCells.tsx:155` (and scale in `ComparisonTable.tsx:153`)
- **Scenario**: A role has a salary band (`hi > 0`) but every candidate's expectation is in a different currency (e.g. EUR expectations vs a CZK band). `showSalary` is true and the band track is drawn, but each `SalaryCell` correctly suppresses its candidate bar and shows a "not comparable" pill.
- **Root cause**: The shared scale is built from the band alone when there are no comparable expectations, so the green band rectangle plots against an axis with no candidate markers. The row reads as "here's the budget" while silently dropping every candidate position, with the explanation buried in a small amber pill per cell.
- **Impact**: At a glance the salary row looks populated and comparable when in fact none of the figures are plotted — the most decision-relevant signal (who's over/under budget) is invisibly absent.
- **Fix sketch**: When `comparableSalary.length === 0`, replace the per-cell bars with a single section-level note ("expectations not comparable to the CZK band — no FX applied") instead of drawing a lone band track, so the empty comparison is explicit.

## 7. List/array children keyed by index cause avoidable churn and unstable a11y focus

- **Severity**: Low
- **Category**: component-correctness / a11y
- **File**: `app/features/sub_decisions/group-eval/FairnessPanel.tsx:49`, `:58`, `:61`, `:82`; `PerCandidateTabs.tsx:25`; `Risks.tsx:13`; `AiVerdict.tsx:43`
- **Scenario**: The fairness matrix header/rows/cells, risk cards, and key-point bullets all use `key={i}`/`key={j}`. Re-running an eval reorders or resizes these lists.
- **Root cause**: Index keys tie React's reconciliation to position, not identity. The fairness panel already has stable `candidateIds`/`labels` and `Risks`/`keyPoints` are strings that could be content-keyed.
- **Impact**: On re-run, cells re-mount in place rather than moving, dropping any in-cell focus/`title` hover state and adding needless DOM churn on a wide matrix. Minor, but it compounds the keyboard issues in finding 3.
- **Fix sketch**: Key the fairness rows/columns by `candidateIds[i]`/`labels[j]` (or a composite `${rowId}-${colId}` for cells) and risks/key-points by their string content (dedupe if needed).
