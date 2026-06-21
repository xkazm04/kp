# Candidate Profile & Job Matching — UI Perfectionist scan

> Context: Build a structured CandidateProfile from evidence and match one candidate against many jobs with deterministic scoring plus cached LLM reasoning. Covers Profile, Match, archetypes, and the candidate matrix.
> Files reviewed: 13 of 35
> Total: 7 findings — Critical: 0, High: 3, Medium: 3, Low: 1

## 1. Re-rank/re-weight failure wipes the entire result panel

- **Severity**: High
- **Category**: error-state / interaction-correctness
- **File**: `app/features/sub_match/MatchTab.tsx:170-193` (gate), `app/features/sub_match/MatchTab.tsx:52-75` (runMatchFor)
- **Scenario**: A recruiter has a full ranked result on screen, opens the WeightsPanel, drags a slider and clicks "Apply re-rank". The `/api/match` POST fails (network blip, Python timeout, 500).
- **Root cause**: `runMatchFor` deliberately does NOT clear `result` on a re-run (comment lines 56-59 — to keep `<Results>`/`WeightsPanel` mounted), but the render gate is ordered `error ? … : result ? <Results …> : …`. Because `error` is checked first, any error — even a transient re-weight failure with a perfectly good prior `result` still in state — replaces the whole ranking, WeightsPanel, shortlist selections and CSV-export affordance with a single red line.
- **Impact**: One failed re-rank throws away the entire on-screen ranking and all local selections; the recruiter must re-run from scratch. The component's own stated design goal (keep results mounted during a re-rank) is silently defeated by the gate order.
- **Fix sketch**: When `result` exists, render `<Results>` and surface the error as an inline non-destructive banner above/inside it (pass `error` into `Results`, or render the error block adjacent to a still-mounted `<Results>`). Only fall to the full-panel error when there is no prior `result`.

## 2. Candidate matrix is a giant near-empty grid that collapses with many archetypes

- **Severity**: High
- **Category**: responsiveness / visual-hierarchy / component-design
- **File**: `app/features/sub_profile/CandidateMatrix.tsx:90-117` (table), `:41-57` (columns/rows)
- **Scenario**: An org with ~6+ archetypes opens Profile › Candidate Matrix with a normal candidate list. The table renders one `<th>` per archetype and one `<tr>` per candidate, but each candidate fills exactly ONE cell (its routed archetype) and shows a grey `·` placeholder in every other column.
- **Root cause**: The layout is a full N-column × M-row matrix used to display a 1-of-N categorical value per row. `table-fixed` (line 91) splits width equally across all columns, so with many archetypes each column is squeezed and the candidate card inside truncates hard, while N−1 cells per row are dead space. The result is mostly whitespace plus a horizontal scrollbar.
- **Impact**: Poor information density and scannability — the dominant visual is empty cells and dots; cards truncate names/roles; horizontal scrolling hides columns. It does not scale past a handful of archetypes.
- **Fix sketch**: Replace the sparse matrix with per-archetype grouped sections/columns (a column-of-cards "kanban" keyed by archetype, only populated columns shown) or a single sortable table with an Archetype column. If the matrix metaphor is kept, drop `table-fixed`, set sensible min/max column widths, and only render columns that have at least one candidate.

## 3. Match candidate `<select>` has no loading state and silently shows empty during fetch

- **Severity**: High
- **Category**: missing-loading-state / a11y
- **File**: `app/features/sub_match/MatchTab.tsx:122-159` (selects), `:30-48` (fetch)
- **Scenario**: User opens the Match tab. Until `/api/profile` and `/api/analyses` resolve, `profiles`/`analyses` are `[]`, so the candidate `<select>` renders only the `noProfiles`/`noAnalyses` "nothing here" option even though data is loading; the run button is disabled with no spinner. If a fetch *fails* (the `.catch(() => undefined)` swallows it), the empty state is indistinguishable from a real empty corpus.
- **Root cause**: There is no `loading`/`loaded` flag for the two list fetches and no error surface — the catch is a no-op. The empty-option branch (`profiles.length === 0`) conflates three states: loading, fetch-error, and genuinely-empty.
- **Impact**: A user momentarily sees "no saved profiles", and on a failed request sees it permanently with no retry or error, making the Match tab look broken/empty when the network failed.
- **Fix sketch**: Track a `listsLoading` flag and render a disabled "Loading candidates…" option (and/or skeleton) while pending; on `.catch`, set an error and show a retry. Only show `noProfiles`/`noAnalyses` once a successful empty response has resolved.

## 4. Archetype edit panel: weight `<input type=number>` accepts/echoes invalid values via `Number()`

- **Severity**: Medium
- **Category**: validation / interaction-correctness
- **File**: `app/features/sub_profile/ArchetypeManager.tsx:334-341` (number inputs), `:73-74` (pctSum), `:110` (payload)
- **Scenario**: In Edit/Create archetype, a recruiter clears a weight field or types a non-numeric/out-of-range value. `onChange={(e) => setPct(slot, Number(e.target.value))}` stores `Number("")` → `0` and `Number("abc")` → `NaN`. With `min={0} max={100}` only enforced by the browser spinner, a pasted `250` or empty field flows straight into `pct`.
- **Root cause**: The number input value is coerced with bare `Number()` with no clamp/NaN guard before it enters `draft.pct`. `pctSum` then becomes `NaN` (an empty/`abc` field), and `pctSum === 100` is false, so the only feedback is the generic "weights must sum to 100" error — it never tells the user *which* field is invalid, and a `NaN` sum reads as a confusing "NaN%".
- **Impact**: Confusing validation: the live total can show `NaN%` (line 329) and the sum error fires without pointing at the offending field; an empty field silently becomes `0` rather than prompting.
- **Fix sketch**: Clamp on input (`Math.max(0, Math.min(100, Math.round(Number(v) || 0)))`) and treat empty as empty, not 0. Render a per-field error and guard `pctSum` rendering against `NaN` (`Number.isFinite(pctSum) ? pctSum : 0`).

## 5. Skill/evidence rows have no empty state and always seed a blank row

- **Severity**: Medium
- **Category**: missing-empty-state / component-consistency
- **File**: `app/features/sub_profile/ProfileEvidenceColumn.tsx:22-55` (skills), `:57-107` (evidence); `app/features/sub_profile/ProfileEditor.tsx:64-65` (fallback seeding)
- **Scenario**: A recruiter opens a fresh profile (or an edited one whose skills were all cleared). `SKILL_FALLBACK`/`EVIDENCE_FALLBACK` force at least one blank row, and if the user removes the last row the section becomes a bare label with only the dashed "Add" button — no guidance on what the section is for or that it is intentionally empty.
- **Root cause**: The columns render `skills.map(...)` directly with no zero-length branch; emptiness is "papered over" by always seeding a fallback row rather than showing a real empty state with a one-line purpose hint.
- **Impact**: Inconsistent with the rest of the feature, which has thoughtful empty states (CandidateMatrix `emptyTitle`, MatchShared `Card`). The intake's two most important sections read as visually unfinished when empty.
- **Fix sketch**: Add a small dashed empty hint ("No skills yet — add the candidate's claimed skills and how each was evidenced") shown when the list is empty, mirroring CandidateMatrix's empty card, and keep the existing AddBtn beneath it.

## 6. WeightsPanel sliders have no min/max/current tick labels or value text for non-pointer users

- **Severity**: Medium
- **Category**: a11y / polish
- **File**: `app/features/sub_match/WeightsPanel.tsx:77-98`
- **Scenario**: A keyboard or screen-reader user adjusts match weights. Each `<input type=range>` carries an `aria-label` (good) but no `aria-valuetext`, and the only visible value is the `%` rendered in the label row. The slider's bounds (`bounds[d]`, e.g. 10–60) are not announced or shown as min/max ticks, so the user can't tell why the slider stops short of 0/100.
- **Root cause**: The range input relies on the native `min`/`max` numeric value (announced as a bare number) without `aria-valuetext` (e.g. "Skills 45% of 10–60% allowed") and without visible min/max anchors, so the archetype-imposed bounds are invisible until the thumb refuses to move.
- **Impact**: The bounded weighting (a core fairness guardrail) is opaque to non-pointer users; a slider that won't reach an expected value reads as broken rather than intentionally clamped.
- **Fix sketch**: Add `aria-valuetext` summarising current % and the allowed range, and render small min/max anchors (`{lo*100}` … `{hi*100}`) under each slider so the bounds are visible to everyone.

## 7. MatchCard "Explain fit" toggle button label changes but offers no busy affordance beyond text

- **Severity**: Low
- **Category**: polish / loading-feedback
- **File**: `app/features/sub_match/MatchCard.tsx:128-137`
- **Scenario**: User clicks "Explain fit"; the button text swaps to `reasoningBusy` and is disabled, while the full skeleton renders below in `ReasoningPanel`. The button itself has no spinner/icon — only a text swap — so on a slow run the small text-only change is easy to miss next to the rich skeleton.
- **Root cause**: The explain button conveys busy state purely through a translated text swap with `disabled` opacity; there is no inline icon/spinner, unlike other primary actions in the feature that pair text with a `lucide` icon.
- **Impact**: Minor — momentary ambiguity about whether the click registered; low blast radius because the sibling skeleton + sr-only live region already communicate progress.
- **Fix sketch**: Add a small spinning icon (e.g. `Loader2 animate-spin`) inside the button while `reasoning?.loading`, consistent with the icon+label pattern used by the CSV/compare/add buttons.
