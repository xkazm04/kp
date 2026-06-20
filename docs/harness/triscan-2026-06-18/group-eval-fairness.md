# Group Evaluation & Fairness — Tri-Lens Scan
> Total: 5
> Severity: 1 Critical / 2 High / 2 Medium / 0 Low
> Lens: 2 bug / 1 ui / 2 biz

## 1. A knockout-failed candidate can be crowned "recommended lead" and sealed into the decision record
- **Lens**: 🐛 Bug Hunter (primary) / 🚀 Business Visionary
- **Severity**: Critical
- **Category**: Correctness / fairness-defensibility / success-theater
- **Value**: impact 9/10 · effort 3/10 · risk 2/10
- **File**: `app/_lib/group-eval-run.ts:345`
- **Scenario**: A candidate fails a must-have knockout (`koPassed === false`) but, because the recruiter ranker still emits a numeric `total`, sorts highest by `score`. `candidates.sort((a,b) => b.score - a.score)` makes them `candidates[0]` → `top`. The modal then crowns rank-1 with the moss "Lead" pill (`ComparisonTable.tsx:33`) — while the SAME header's KO branch (`:37`) is unreachable for rank-1 — and `deterministicSummary` declares them "Recommended lead". Worse, `sealDecisionSafe({ kind: "group_eval_lead", … })` (`:382`) writes that contradictory recommendation into the tamper-evident decision System-of-Record.
- **Root cause**: Ranking sorts on raw `score` only; `koPassed` is carried for display but never gates lead selection or ordering, and the "Lead" vs "KO" pills are mutually exclusive in the header so the contradiction is hidden, not surfaced.
- **Impact**: The product's headline output (the lead a recruiter acts on) can recommend someone who structurally fails the role's hard requirements — the exact opposite of a defensible hiring decision — and that flawed recommendation is permanently sealed as audit truth.
- **Fix sketch**: Partition before `top`: rank KO-passed candidates ahead of KO-failed (`sort` by `koPassed !== false` first, then score). If the only candidates are KO-failed, set `topPick=null`/skip the seal, or stamp the lead pill with an explicit "KO — does not meet must-haves" warning. Add a risk entry for every `koPassed === false`.

## 2. Group evaluation has no export / shareable audit artifact
- **Lens**: 🚀 Business Visionary (primary)
- **Severity**: High
- **Category**: Missing capability / defensibility
- **Value**: impact 8/10 · effort 4/10 · risk 2/10
- **File**: `app/features/sub_decisions/GroupEvalModal.tsx:75`
- **Scenario**: A recruiter runs a side-by-side comparison, fairness matrix, differentiators and risks, then needs to share the rationale with a hiring manager or retain it for an equal-opportunity / discrimination challenge. The modal's only footer action is "Re-run"; there is no Export/PDF/CSV/copy. The rich fairness evidence lives only behind a modal that re-fetches a cached blob and vanishes on close.
- **Root cause**: The feature was built as an ephemeral on-screen view. The data (`GroupEvalPayload`, including the fairness matrix and `weightNotes`) is fully structured and persisted, but no surface emits it as a shareable artifact.
- **Impact**: A paying recruiter expects a defensible, exportable record of WHY a candidate was preferred — especially for the fairness/bias panel that is the headline differentiator. Without it the audit trail is non-transferable and the panel's compliance value is largely theater.
- **Fix sketch**: Add an "Export" footer button that serializes the payload to a PDF/printable HTML (candidates, score breakdown, fairness matrix + weight notes, differentiators, risks, source + `createdAt`). The decision SoR already seals the lead; link the exported artifact's hash to it for a tamper-evident chain.

## 3. Pool-drift staleness is detected by display label, so a swapped same-name candidate reads as "no drift"
- **Lens**: 🐛 Bug Hunter (primary)
- **Severity**: Medium
- **Category**: Staleness detection / identity mismatch
- **Value**: impact 6/10 · effort 3/10 · risk 3/10
- **File**: `app/features/sub_decisions/DecisionsTab.tsx:255`
- **Scenario**: `evalDrift` diffs `evaluatedLabels` (display labels) against the current pool's `candidateLabel`. The eval engine itself dedupes and keys identity by `candidateId || entryId` (`group-eval-run.ts:259`) precisely because labels are non-unique. If candidate "J. Novák" leaves the pool and a different "J. Novák" is added, the label sets match → `drift = 0` → the stale-comparison banner never shows, and the recruiter trusts an evaluation computed over a different person.
- **Root cause**: Drift is computed on labels while every other identity operation in the feature deliberately keys on stable ids; `evaluatedLabels` is the only id-less snapshot persisted.
- **Impact**: Silent staleness on the exact axis (identity) the rest of the module hardened against — a recruiter acts on an out-of-date comparison without warning.
- **Fix sketch**: Persist an `evaluatedIdentities` array (`candidateId || entryId`) alongside `evaluatedLabels` in the payload (`group-eval-run.ts:406`) and diff on that in `evalDrift`; keep labels for display only.

## 4. Fairness matrix renders unguarded `schemes[j]` / `matrix[i][j]` from an untrusted Python blob
- **Lens**: 🐛 Bug Hunter (primary)
- **Severity**: Medium
- **Category**: Trust-boundary validation / render crash
- **Value**: impact 5/10 · effort 2/10 · risk 3/10
- **File**: `app/features/sub_decisions/group-eval/FairnessPanel.tsx:52`
- **Scenario**: `fairness` arrives from `recruiter_cli`/`parsePythonJson` via an `as` cast (`group-eval-run.ts:168`) — runtime-unchecked. The panel guards only `labels.length` and `matrix.length`, then unconditionally calls `fmtScheme(schemes[j])` (`:52`, dereferences `.skills`) and `matrix[i][j]` (`:69`) for every label index. If the CLI emits a ragged matrix or a `schemes` array shorter than `labels` (a partial/ranker degradation), `schemes[j]` is `undefined` and `fmtScheme` throws, white-screening the whole evaluation inside the modal.
- **Root cause**: The wire contract is trusted by shape; only top-level array presence is checked, not per-row/column length alignment.
- **Impact**: One malformed fairness payload takes down the entire group-eval view (not just the panel), turning a best-effort enrichment into a hard failure.
- **Fix sketch**: Bail to the "uniform/unavailable" state unless `schemes.length === labels.length` and every `matrix[i].length === labels.length`; or guard each access (`schemes[j] ? fmtScheme(schemes[j]) : "—"`, `matrix[i]?.[j] ?? "—"`). Cheapest: validate dimensions once at the top and `return null` on mismatch.

## 5. Per-candidate tabs lack keyboard semantics, active-tab indication, and live-region feedback
- **Lens**: 🎨 UI Perfectionist (primary)
- **Severity**: High
- **Category**: Accessibility (WCAG 2.1.1 / 4.1.2)
- **Value**: impact 6/10 · effort 4/10 · risk 2/10
- **File**: `app/features/sub_decisions/group-eval/PerCandidateTabs.tsx:160`
- **Scenario**: The `role="tablist"` exposes tabs with `role="tab"` + `aria-selected`, but (a) there is no arrow-key navigation between tabs (WAI-ARIA tabs pattern expects Left/Right + roving tabindex), (b) the single `role="tabpanel"` has no `aria-labelledby`/`id` linking it to its tab and no `tabindex`, and (c) inline Advance/Reject (`:84`,`:91`) — an irreversible action — gives no screen-reader confirmation; the outcome only flips a visual pill with no `aria-live` announcement. A keyboard/AT user can't move across candidates with arrows and isn't told an advance/reject landed.
- **Root cause**: Tabs were built with the ARIA roles but not the interaction contract; decision feedback is purely visual.
- **Impact**: The core comparison surface is partially unusable by keyboard/AT users, and an irreversible hiring action is taken with no non-visual confirmation — both a real a11y defect and a decision-safety gap.
- **Fix sketch**: Add roving-tabindex + `onKeyDown` arrow handling on the tablist, link `tabpanel` via `id`/`aria-labelledby` and make it focusable, and wrap the decided-outcome pill (or a visually-hidden status node) in `aria-live="polite"` so "Advanced/Rejected <name>" is announced.
