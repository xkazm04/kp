# Decision Workflow & Group Eval — UI+Bug combined scan
> Total: 4 findings (0 crit / 2 high / 1 med / 1 low)
> Group: Matching & Decisions | Lens mix: 3 bug / 1 ui | Files read: 16

## 1. Inline group-eval decide resolves candidates by display label, not by id — wrong candidate can be advanced/rejected
- **Severity**: High
- **Lens**: 🐛 Bug Hunter
- **Category**: Validation gap at a trust boundary / identity confusion on an irreversible action
- **File**: `app/features/sub_decisions/DecisionsTab.tsx:314` (resolution) + `app/features/sub_decisions/GroupEvalModal.tsx:168-175` (`decided` keyed by label)
- **Scenario**: A role's pool contains two pending entries whose `candidateLabel` is the same string (e.g. two "Jan Novák", or any duplicated display name — `candidateLabel` is free text with no uniqueness constraint; identity is `candidateId`/`entryId`, see `app/_lib/db.ts:1287-1289`). The recruiter clicks Advance/Reject on one of them in the GroupEval comparison.
- **Root cause**: The inline-decide handler maps the eval candidate back to a live pipeline entry purely by label: `evalGroup?.entries.find((x) => x.candidateLabel === label)`. `Array.find` returns the FIRST match, so the decision (status flip + queued rejection email via `act()`'s expectedStage CAS) lands on whichever duplicate-named entry happens to be first in the pool — not necessarily the candidate the recruiter was looking at. Compounding it, the modal's `decided` map (`GroupEvalModal.tsx:168`) and the pool-drift diff (`DecisionsTab.tsx:178-186`, `evaluatedLabels` set membership) are both keyed by label, so both same-named tabs flip to the recorded outcome and drift math can mis-count.
- **Impact**: An irreversible auto-decision (advance, or reject + candidate notification email) can be applied to the wrong person when two pending candidates in one role share a display name. Silent — no error, the UI shows "Advanced"/"Rejected" confidently. Same class of bug the server-side CAS work was meant to eliminate, but reintroduced on the client by routing identity through the label.
- **Fix sketch**: Carry `entryId` (already present on `g.entries` and known when building the eval payload) through `EvalCandidate` and resolve by it: `onDecide(entryId, action)` → `evalGroup?.entries.find((x) => x.id === entryId)`; key the `decided` map and tab badges by `entryId` too. Label can stay as the display string only.

## 2. Cached group-eval that fails to load shows the misleading "No evaluation yet" empty state
- **Severity**: Medium
- **Lens**: 🎨 UI Perfectionist
- **Category**: Missing/wrong error state
- **File**: `app/features/sub_decisions/DecisionsTab.tsx:152-156` + `GroupEvalModal.tsx:213-214`
- **Scenario**: A role is marked `evaluated` (its key is in `listEvaluatedRoles`), but reading the saved payload returns null — e.g. `getGroupEval` hits the `JSON.parse` catch and returns null (`app/_lib/group-eval.ts:61-65`), or the row was removed between the list call and the read. `openGroupEval` takes the cached branch, sets `evalData = null`, and `return`s without setting `evalTaskId`.
- **Root cause**: The modal's three states are `loading` (`evalTaskId !== null` → false here), `error` (DecisionsTab never passes the `error` prop at all — see the `<GroupEvalModal>` props at `DecisionsTab.tsx:295-318`, no `error={...}`), then `!evaluation`. So a failed cache read falls through to the final branch and renders "No evaluation yet — run one to compare this role's candidates." despite the View-evaluation button having promised a saved one. The modal already supports an honest error branch (`GroupEvalModal.tsx:206-212`) but it's unreachable from this tab.
- **Impact**: Recruiter clicks "View evaluation", gets a confusing empty prompt for a role that says it was evaluated, with no indication the stored eval was unreadable/missing. Dead-end; only recovery is to re-run, which isn't suggested as the cause.
- **Fix sketch**: In the cached branch, when `p.evaluation` is null, set an error message (and pass an `error` state down via the unused `error` prop) so the modal shows "Saved evaluation couldn't be loaded — re-run it." Wire `error={...}` into the `<GroupEvalModal>` instance.

## 3. DecisionRulesModal save returns to a stale view on a 400 — out-of-range/blur edits silently diverge from the saved config
- **Severity**: Low
- **Lens**: 🐛 Bug Hunter (silent failure)
- **Category**: Silent failure / client-server state divergence
- **File**: `app/features/sub_decisions/DecisionRulesModal.tsx:27-44`
- **Scenario**: The server clamps `rejectBottomPercent`/`maxMatchToReject` to 0–100 and returns the clamped, canonical config in the POST response (`app/api/decisions/config/route.ts:25-26`, `getAllDecisionConfigs()`). The modal ignores that response: on success it only sets `note = "Saved."` and never re-reads `rule` from the returned config.
- **Root cause**: `save()` discards `r.json()`. The local `rule` state is what the user typed; the persisted/clamped value is what the server stored. The modal's own inline clamp (`Math.max(0, Math.min(100, ...))` at lines 94/107) keeps the two aligned for normal typing, so the divergence is narrow — but the displayed rule sentence (lines 113-124) can still reflect an unsaved/over-typed value after a successful save without reflecting any server-side normalization, and there's no re-sync.
- **Impact**: Low — the configured-percentage-matches-what-executes invariant (the whole point of single-sourcing the schema) is shown but not re-confirmed against what was actually stored. Mostly a robustness/trust gap; becomes user-visible only if the server clamp ever diverges from the client clamp.
- **Fix sketch**: On a successful POST, `setRule({ ...FALLBACK, ...(d.configs?.screening ?? rule) })` from the response body, so the modal always shows exactly what was persisted.

## 4. Group-eval candidate count can drift from `candidateCount` when duplicate candidateIds collapse during resolution
- **Severity**: High
- **Lens**: 🐛 Bug Hunter
- **Category**: Edge case / aggregation correctness
- **File**: `app/_lib/group-eval-run.ts:116-124` + `:266-272` + `:382-390`
- **Scenario**: A role's pending pool contains two pipeline entries pointing at the SAME `candidateId` (a candidate re-added / duplicated into the same role — entries are distinct, the underlying profile is not). The eval input keeps both rows (sorted+capped by `matchScore`), but `resolveCandidates` dedupes by `candidateId` (`if (... resolved.has(c.candidateId)) continue;`) and `rankCandidates` builds its row map keyed by `candidateId` (`map.set(row.candidateId, row)`, line 189), so the recruiter ranker collapses the pair to one row.
- **Root cause**: The per-candidate loop (`:313`) still iterates the un-deduped `input`, so it emits TWO `PerCandidate` rows for the same person (both reading the same shared snapshot), while `evaluatedLabels` (`:390`) is built from the full pre-cap `allCandidates`. Downstream the comparison table renders duplicate columns for one human, `topPick`/`recommendedOrder` can list them twice, and the pool-drift diff (DecisionsTab) compares label sets that no longer line up 1:1 with entries. The cap (`GROUP_EVAL_CAP = 6`, `:268`) is also consumed by the duplicate, so a genuine 6th candidate can be silently dropped.
- **Impact**: A duplicated candidate inflates the comparison (two identical columns, double-counted in the lead/order and risks list at `:360-364`) and can evict a real candidate past the cap — the "Recommended lead" presented as authoritative is computed over a skewed field. Reaches the recruiter's decision surface.
- **Fix sketch**: Dedupe `input` by a stable identity (`candidateId` when present, else `entryId`) BEFORE the cap+slice at `:266-268`, mirroring `resolveCandidates`' dedupe, so the cap counts distinct people and the per-candidate loop can't emit duplicate columns. Keep label only for display.
